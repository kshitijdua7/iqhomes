import { describe, expect, it } from 'vitest';
import { Auth, canControl, canManagePeople, canRunScenes, filterPatches } from '../src/auth';
import { createDevices } from '../src/home';

const devices = createDevices();
const dev = (id: string) => devices.find((d) => d.id === id)!;

function setup() {
  const auth = new Auth();
  const owner = auth.data.users.find((u) => u.role === 'owner')!;
  const family = auth.data.users.find((u) => u.role === 'family')!;
  return { auth, owner, family };
}

describe('sign-in', () => {
  it('accepts the right PIN and rejects a wrong one', () => {
    const { auth, owner } = setup();
    expect(auth.login(owner.id, '0000', 'ip')).toHaveProperty('error');
    const ok = auth.login(owner.id, '1234', 'ip');
    expect(ok).toHaveProperty('token');
    if ('token' in ok) expect(auth.userFor(ok.token)?.id).toBe(owner.id);
  });

  it('never stores PINs in plain text', () => {
    const { auth } = setup();
    expect(JSON.stringify(auth.data)).not.toMatch(/"1234"|"2222"/);
  });

  it('locks out after five wrong tries', () => {
    const { auth, owner } = setup();
    for (let i = 0; i < 5; i++) auth.login(owner.id, '9999', 'attacker');
    const r = auth.login(owner.id, '1234', 'attacker');
    expect('error' in r && r.error).toMatch(/Too many/);
    expect(auth.login(owner.id, '1234', 'someone-else')).toHaveProperty('token');
  });
});

describe('guest passes', () => {
  it('signs in with the code and stops working once revoked', () => {
    const { auth, owner } = setup();
    const { user, code } = auth.createGuest(owner, 'Alex', ['living'], 3);
    const s = auth.login(undefined, code, 'ip');
    expect(s).toHaveProperty('token');
    auth.removeGuest(user.id);
    if ('token' in s) expect(auth.userFor(s.token)).toBeUndefined();
  });

  it('expires on its own', () => {
    const { auth, owner } = setup();
    const { user, code } = auth.createGuest(owner, 'Sam', ['living'], 1);
    const s = auth.login(undefined, code, 'ip');
    auth.data.users.find((u) => u.id === user.id)!.expiresAt = Date.now() - 1;
    if ('token' in s) expect(auth.userFor(s.token)).toBeUndefined();
    expect(auth.login(undefined, code, 'ip2')).toHaveProperty('error');
  });
});

describe('permissions', () => {
  it('owner and family control everything; only the owner manages people', () => {
    const { owner, family } = setup();
    for (const d of devices) { expect(canControl(owner, d)).toBe(true); expect(canControl(family, d)).toBe(true); }
    expect(canManagePeople(owner)).toBe(true);
    expect(canManagePeople(family)).toBe(false);
    expect(canRunScenes(family)).toBe(true);
  });

  it('guests only control their rooms, never locks or the thermostat, and no scenes', () => {
    const guest = { id: 'g', name: 'Alex', role: 'guest' as const, avatar: '🎟️', rooms: ['living', 'entrance'] };
    expect(canControl(guest, dev('living-main'))).toBe(true);
    expect(canControl(guest, dev('kitchen-main'))).toBe(false);   // not their room
    expect(canControl(guest, dev('front-door'))).toBe(false);     // entrance is theirs, but locks never are
    expect(canControl(guest, dev('thermostat'))).toBe(false);     // living is theirs, but not the thermostat
    expect(canRunScenes(guest)).toBe(false);

    const { allowed, denied } = filterPatches(guest, [
      { id: 'living-main', changes: { on: true } },
      { id: 'front-door', changes: { locked: false } },
    ], devices);
    expect(allowed.map((p) => p.id)).toEqual(['living-main']);
    expect(denied.map((d) => d.id)).toEqual(['front-door']);
  });
});
