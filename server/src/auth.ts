import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Device, DevicePatch, PublicUser, Role } from './types.js';

/**
 * People, sign-in and permissions.
 *
 *  owner  – everything, plus managing people and guest passes
 *  family – every device and scene, but can't manage people
 *  guest  – only the rooms on their pass, never locks or the thermostat, no whole-house scenes,
 *           and the pass stops working at its expiry time
 *
 * Every rule is enforced here on the server; the web app only hides buttons for a nicer experience.
 */

export interface StoredUser extends PublicUser {
  pinHash: string; // scrypt(salt, pin) – PINs are never stored in plain text
  salt: string;
  createdBy?: string;
}

export interface AuthData {
  users: StoredUser[];
  sessions: Record<string, string>; // token -> user id
}

/** Device types a guest may never touch, wherever they are. */
const GUEST_BLOCKED_TYPES = new Set<Device['type']>(['lock', 'thermostat', 'garage', 'sensor']);

const hash = (pin: string, salt: string) => scryptSync(pin, salt, 32).toString('hex');

function makeUser(name: string, role: Role, pin: string, avatar: string, extra: Partial<StoredUser> = {}): StoredUser {
  const salt = randomBytes(16).toString('hex');
  return { id: randomBytes(6).toString('hex'), name, role, avatar, salt, pinHash: hash(pin, salt), ...extra };
}

export const DEFAULT_PINS = { owner: '1234', family: '2222' };

export class Auth {
  data: AuthData;
  private failures = new Map<string, { count: number; until: number }>();

  constructor(saved?: AuthData, private onChange: () => void = () => {}) {
    this.data = saved?.users?.length
      ? { users: saved.users, sessions: saved.sessions ?? {} }
      : {
          users: [
            makeUser('Kshitij', 'owner', DEFAULT_PINS.owner, '👑'),
            makeUser('Family', 'family', DEFAULT_PINS.family, '🏡'),
          ],
          sessions: {},
        };
    this.prune();
  }

  /** People shown on the sign-in screen. Guests sign in with their pass code instead, so they aren't listed. */
  profiles(): PublicUser[] {
    return this.data.users.filter((u) => u.role !== 'guest').map(toPublic);
  }

  guests(): PublicUser[] {
    this.prune();
    return this.data.users.filter((u) => u.role === 'guest').map(toPublic);
  }

  /** Sign in with a profile + PIN, or (with no userId) with a guest pass code. Returns a session token. */
  login(userId: string | undefined, pin: string, clientKey: string): { token: string; user: PublicUser } | { error: string } {
    const lock = this.failures.get(clientKey);
    if (lock && lock.until > Date.now()) {
      return { error: `Too many wrong tries. Wait ${Math.ceil((lock.until - Date.now()) / 1000)}s.` };
    }
    this.prune();
    const candidates = userId
      ? this.data.users.filter((u) => u.id === userId && u.role !== 'guest')
      : this.data.users.filter((u) => u.role === 'guest');
    const user = candidates.find((u) => safeEqual(u.pinHash, hash(String(pin), u.salt)));
    if (!user) {
      const count = (lock?.until && lock.until > Date.now() ? lock.count : (lock?.count ?? 0)) + 1;
      // after 5 misses, back off for 30 seconds
      this.failures.set(clientKey, { count: count >= 5 ? 0 : count, until: count >= 5 ? Date.now() + 30_000 : 0 });
      return { error: userId ? 'Wrong PIN.' : 'That guest code is not valid or has expired.' };
    }
    this.failures.delete(clientKey);
    const token = randomBytes(24).toString('hex');
    this.data.sessions[token] = user.id;
    this.onChange();
    return { token, user: toPublic(user) };
  }

  logout(token: string) {
    delete this.data.sessions[token];
    this.onChange();
  }

  /** The user behind a session token, or undefined if the token (or the guest pass) is no longer valid. */
  userFor(token: string | undefined): StoredUser | undefined {
    if (!token) return undefined;
    const id = this.data.sessions[token];
    const user = this.data.users.find((u) => u.id === id);
    if (!user || isExpired(user)) return undefined;
    return user;
  }

  /** Owner-only: create a time-limited guest pass. The code is shown once and only its hash is stored. */
  createGuest(owner: StoredUser, name: string, rooms: string[], hours: number): { user: PublicUser; code: string } {
    let code: string;
    do { code = String(randomInt(100000, 1000000)); } while (this.data.users.some((u) => u.role === 'guest' && safeEqual(u.pinHash, hash(code, u.salt))));
    const user = makeUser(name.trim().slice(0, 24) || 'Guest', 'guest', code, '🎟️', {
      rooms, expiresAt: Date.now() + Math.min(Math.max(hours, 1), 24 * 14) * 3_600_000, createdBy: owner.id,
    });
    this.data.users.push(user);
    this.onChange();
    return { user: toPublic(user), code };
  }

  /** Owner-only: revoke a guest pass immediately (their open sessions stop working too). */
  removeGuest(id: string): boolean {
    const before = this.data.users.length;
    this.data.users = this.data.users.filter((u) => !(u.id === id && u.role === 'guest'));
    if (this.data.users.length === before) return false;
    this.dropSessionsOf(id);
    this.onChange();
    return true;
  }

  changePin(user: StoredUser, pin: string): boolean {
    if (!/^\d{4,8}$/.test(pin)) return false;
    user.salt = randomBytes(16).toString('hex');
    user.pinHash = hash(pin, user.salt);
    this.onChange();
    return true;
  }

  /** Removes expired guests and their sessions. */
  prune() {
    const expired = this.data.users.filter(isExpired);
    if (!expired.length) return;
    this.data.users = this.data.users.filter((u) => !isExpired(u));
    for (const u of expired) this.dropSessionsOf(u.id);
    this.onChange();
  }

  private dropSessionsOf(userId: string) {
    for (const [t, id] of Object.entries(this.data.sessions)) if (id === userId) delete this.data.sessions[t];
  }
}

// ---- Permission rules ----

export function canControl(user: PublicUser, device: Device): boolean {
  if (user.role !== 'guest') return true;
  return !GUEST_BLOCKED_TYPES.has(device.type) && (user.rooms ?? []).includes(device.room);
}

export const canRunScenes = (user: PublicUser) => user.role !== 'guest';
export const canManagePeople = (user: PublicUser) => user.role === 'owner';

/** Splits patches into the ones this user may apply and the devices they were refused on. */
export function filterPatches(user: PublicUser, patches: DevicePatch[], devices: Device[]) {
  const allowed: DevicePatch[] = [];
  const denied: Device[] = [];
  for (const p of patches) {
    const d = devices.find((x) => x.id === p.id);
    if (!d) continue;
    if (canControl(user, d)) allowed.push(p);
    else if (!denied.includes(d)) denied.push(d);
  }
  return { allowed, denied };
}

export function toPublic(u: StoredUser): PublicUser {
  const { id, name, role, avatar, rooms, expiresAt } = u;
  return { id, name, role, avatar, ...(rooms ? { rooms } : {}), ...(expiresAt ? { expiresAt } : {}) };
}

const isExpired = (u: StoredUser) => u.role === 'guest' && !!u.expiresAt && u.expiresAt <= Date.now();

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
