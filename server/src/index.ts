import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import { Home } from './home.js';
import { interpret } from './assistant.js';
import { Auth, DEFAULT_PINS, canControl, canManagePeople, canRunScenes, filterPatches, toPublic, type StoredUser } from './auth.js';
import { Hardware, plugsFromEnv } from './hardware.js';
import { Push, type Alert } from './push.js';
import type { Device, DevicePatch, HomeState, Lock } from './types.js';

const PORT = Number(process.env.PORT ?? 4000);
const DOOR_REMINDER_MIN = Number(process.env.DOOR_REMINDER_MIN ?? 10);
const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR ?? join(here, '..', 'data');
const WEB_DIST = join(here, '..', '..', 'web', 'dist');

// ---- Persistence: small JSON files in server/data (git-ignored, so PINs, keys and tokens never reach GitHub) ----
function load<T>(name: string): T | undefined {
  try { const f = join(DATA_DIR, name); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : undefined; } catch { return undefined; }
}
const timers: Record<string, NodeJS.Timeout> = {};
function persist(name: string, data: () => unknown) {
  clearTimeout(timers[name]);
  timers[name] = setTimeout(() => {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(join(DATA_DIR, name), JSON.stringify(data(), null, 2));
  }, 300);
}

const home = new Home(load('state.json'));
const saveHome = () => persist('state.json', () => ({
  devices: home.state.devices.map(({ hardware: _hw, ...d }) => d),
  activity: home.state.activity,
}));
const firstRun = !load('auth.json');
const auth: Auth = new Auth(load('auth.json'), () => persist('auth.json', () => auth.data));
if (firstRun) persist('auth.json', () => auth.data);
const push: Push = new Push(load('push.json'), () => persist('push.json', () => push.data));
const hwConfig = load<{ token: string }>('hardware.json') ?? { token: process.env.HARDWARE_TOKEN ?? randomBytes(9).toString('base64url') };
persist('hardware.json', () => hwConfig);
if (!home.state.activity.length) home.log('system', 'IQHomes started');

// ---- HTTP + WebSocket server ----
const app = express();
app.use(cors());
app.use(express.json({ limit: '20kb' }));
const http = createServer(app);
const io = new Server(http, { cors: { origin: '*' } });

const hardware = new Hardware(() => home.state.devices, hwConfig.token, plugsFromEnv(process.env), {
  report(patch, note) {
    const changed = home.apply([patch], 'hardware', note);
    if (changed.length) afterChange(changed, undefined);
  },
  status() { watchHardware(); broadcast(); },
});
http.on('upgrade', (req, socket, head) => { hardware.handleUpgrade(req, socket, head); });

/** What a particular person is allowed to see. Guests only see their rooms and their own activity. */
function viewFor(user: StoredUser): HomeState {
  if (user.role !== 'guest') return home.state;
  const devices = home.state.devices.filter((d) => canControl(user, d));
  return {
    ...home.state,
    rooms: home.state.rooms.filter((r) => user.rooms?.includes(r.id)),
    devices,
    scenes: [],
    activity: home.state.activity.filter((a) => a.by === user.name),
  };
}

function broadcast() {
  for (const s of io.sockets.sockets.values()) {
    const user = auth.userFor(s.data.token);
    if (!user) { s.emit('session:expired'); s.disconnect(true); continue; }
    s.emit('state', viewFor(user));
  }
  saveHome();
}

/** Runs after any real change: push it to hardware, raise alerts, update every screen. */
function afterChange(changed: Device[], by: StoredUser | undefined) {
  hardware.sync(changed);
  for (const d of changed) if (d.type === 'lock') onLockChanged(d, by);
  broadcast();
}

// ---- Alerts ----
const unlockedSince = new Map<string, { at: number; reminded: boolean }>();
function alert(a: Alert, roles?: Parameters<Push['send']>[1]) {
  io.emit('alert', a); // live toast on every open screen
  void push.send(a, roles);
}
function onLockChanged(d: Lock, by: StoredUser | undefined) {
  if (d.locked) { unlockedSince.delete(d.id); return; }
  unlockedSince.set(d.id, { at: Date.now(), reminded: false });
  alert({ title: `🔓 ${d.name} unlocked`, body: by ? `Unlocked by ${by.name}.` : 'Unlocked from the door itself.', tag: `lock-${d.id}`, url: '/' });
}
setInterval(() => {
  for (const [id, info] of unlockedSince) {
    const d = home.device(id);
    if (!d || d.type !== 'lock' || d.locked) { unlockedSince.delete(id); continue; }
    if (!info.reminded && Date.now() - info.at > DOOR_REMINDER_MIN * 60_000) {
      info.reminded = true;
      alert({ title: `⏰ ${d.name} still unlocked`, body: `It's been unlocked for ${DOOR_REMINDER_MIN} minutes. Tap to lock it.`, tag: `lock-${d.id}`, url: '/?lock=' + id });
    }
  }
}, 30_000).unref();

const wasOnline = new Map<string, boolean>();
function watchHardware() {
  for (const d of home.state.devices) {
    if (!d.hardware) continue;
    const prev = wasOnline.get(d.id);
    wasOnline.set(d.id, d.hardware.online);
    if (prev === undefined || prev === d.hardware.online) continue;
    home.log('hardware', `${d.hardware.online ? '🟢' : '🔴'} ${d.name} (${d.hardware.kind}) ${d.hardware.online ? 'connected' : 'went offline'}`);
    if (!d.hardware.online) alert({ title: `🔴 ${d.name} went offline`, body: `The ${d.hardware.kind} lost its connection.`, tag: `hw-${d.id}` }, ['owner']);
  }
}

// ---- Auth middleware ----
const tokenOf = (req: Request) => (req.headers.authorization ?? '').replace(/^Bearer /, '');
interface Authed extends Request { user: StoredUser; token: string }
function requireUser(req: Request, res: Response, next: NextFunction) {
  const user = auth.userFor(tokenOf(req));
  if (!user) { res.status(401).json({ error: 'Please sign in.' }); return; }
  (req as Authed).user = user;
  (req as Authed).token = tokenOf(req);
  next();
}
function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (!canManagePeople((req as Authed).user)) { res.status(403).json({ error: 'Only the owner can do that.' }); return; }
  next();
}

// ---- REST API ----
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/profiles', (_req, res) => res.json(auth.profiles()));

app.post('/api/login', (req, res) => {
  const { userId, pin } = req.body ?? {};
  const result = auth.login(userId ? String(userId) : undefined, String(pin ?? ''), req.ip ?? 'unknown');
  if ('error' in result) { res.status(401).json(result); return; }
  if (result.user.role === 'guest') {
    home.log('system', `🎟️ ${result.user.name} signed in with a guest pass`, result.user.name);
    alert({ title: '🎟️ Guest arrived', body: `${result.user.name} just signed in with their guest pass.`, tag: 'guest' }, ['owner']);
    broadcast();
  }
  res.json(result);
});

app.post('/api/logout', requireUser, (req, res) => { auth.logout((req as Authed).token); res.json({ ok: true }); });
app.get('/api/me', requireUser, (req, res) => res.json(toPublic((req as Authed).user)));

app.post('/api/me/pin', requireUser, (req, res) => {
  const u = (req as Authed).user;
  if (u.role === 'guest') { res.status(403).json({ error: 'Guest codes can’t be changed.' }); return; }
  if (!auth.changePin(u, String(req.body?.pin ?? ''))) { res.status(400).json({ error: 'PIN must be 4–8 digits.' }); return; }
  res.json({ ok: true });
});

app.get('/api/guests', requireUser, requireOwner, (_req, res) => res.json(auth.guests()));
app.post('/api/guests', requireUser, requireOwner, (req, res) => {
  const { name, rooms, hours } = req.body ?? {};
  const validRooms = (Array.isArray(rooms) ? rooms : []).map(String).filter((r) => home.state.rooms.some((x) => x.id === r));
  if (!validRooms.length) { res.status(400).json({ error: 'Pick at least one room.' }); return; }
  const result = auth.createGuest((req as Authed).user, String(name ?? ''), validRooms, Number(hours) || 24);
  home.log('system', `🎟️ Guest pass created for ${result.user.name}`, (req as Authed).user.name);
  broadcast();
  res.json(result);
});
app.delete('/api/guests/:id', requireUser, requireOwner, (req, res) => {
  const id = String(req.params.id);
  if (!auth.removeGuest(id)) { res.status(404).json({ error: 'No such guest.' }); return; }
  push.dropUser(id);
  broadcast(); // kicks their open screens
  res.json({ ok: true });
});

app.get('/api/hardware', requireUser, requireOwner, (_req, res) => res.json({
  token: hwConfig.token,
  devices: home.state.devices.filter((d) => d.hardware).map((d) => ({ id: d.id, name: d.name, ...d.hardware })),
}));

app.get('/api/push/key', (_req, res) => res.json({ key: push.publicKey }));
app.post('/api/push/subscribe', requireUser, (req, res) => {
  const u = (req as Authed).user;
  res.json({ ok: push.subscribe(u.id, u.role, req.body) });
});
app.post('/api/push/unsubscribe', requireUser, (req, res) => { push.unsubscribe(String(req.body?.endpoint ?? '')); res.json({ ok: true }); });
app.post('/api/push/test', requireUser, async (req, res) => {
  const u = (req as Authed).user;
  await push.send({ title: '🏠 IQHomes', body: `Notifications are working, ${u.name}!`, tag: 'test' }, [u.role]);
  res.json({ ok: true });
});

// ---- Voice / text assistant, with permissions ----
function ask(user: StoredUser, text: string) {
  const result = interpret(text, viewFor(user));
  const { allowed, denied } = filterPatches(user, result.patches, home.state.devices);
  const scenes = canRunScenes(user) ? result.scenes : [];
  const changed: Device[] = [];
  for (const s of scenes) changed.push(...home.runScene(s, 'voice', user.name));
  if (allowed.length) changed.push(...home.apply(allowed, 'voice', `🎙️ "${text.trim()}"`, user.name));
  if (changed.length) afterChange(changed, user);

  let reply = result.reply;
  if (denied.length || scenes.length < result.scenes.length) {
    const what = denied.length ? denied.map((d) => d.name).join(', ') : 'whole-house scenes';
    reply = allowed.length
      ? `${reply} (I skipped ${what}: your guest pass doesn't cover that.)`
      : `Sorry ${user.name}, your guest pass doesn't let you control ${what}.`;
  }
  return { ...result, reply, patches: allowed, scenes, understood: result.understood && (allowed.length > 0 || scenes.length > 0 || !result.patches.length) };
}

app.post('/api/assistant', requireUser, (req, res) => res.json(ask((req as Authed).user, String(req.body?.text ?? '').slice(0, 300))));

// ---- Live socket connection (signed-in users only) ----
io.use((socket, next) => {
  const token = String(socket.handshake.auth?.token ?? '');
  if (!auth.userFor(token)) return next(new Error('unauthorized'));
  socket.data.token = token;
  next();
});

io.on('connection', (socket: Socket) => {
  const current = () => auth.userFor(socket.data.token);
  const first = current();
  if (first) socket.emit('state', viewFor(first));

  socket.on('device:update', (patch: DevicePatch) => {
    const user = current();
    if (!user) return void socket.emit('session:expired');
    const { allowed } = filterPatches(user, [patch], home.state.devices);
    if (!allowed.length) { socket.emit('state', viewFor(user)); socket.emit('denied', 'You don’t have access to that device.'); return; }
    const changed = home.apply(allowed, 'app', undefined, user.name);
    if (changed.length) afterChange(changed, user);
  });

  socket.on('scene:run', (sceneId: string) => {
    const user = current();
    if (!user) return void socket.emit('session:expired');
    if (!canRunScenes(user)) return void socket.emit('denied', 'Guests can’t run whole-house scenes.');
    const changed = home.runScene(sceneId, 'scene', user.name);
    if (changed.length) afterChange(changed, user);
  });

  socket.on('assistant:ask', (text: string, reply?: (r: unknown) => void) => {
    const user = current();
    if (!user) { socket.emit('session:expired'); return; }
    reply?.(ask(user, String(text ?? '').slice(0, 300)));
  });
});

// The simulator: every 2 seconds temperatures drift and the power chart updates on every screen.
setInterval(() => {
  home.tick();
  for (const s of io.sockets.sockets.values()) {
    const user = auth.userFor(s.data.token);
    if (!user) continue;
    const view = viewFor(user);
    s.emit('tick', { devices: view.devices, energy: home.state.energy });
  }
}, 2000);

// In production, serve the built React app from the same server.
if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get('*', (_req, res) => res.sendFile(join(WEB_DIST, 'index.html')));
}

http.listen(PORT, () => {
  console.log(`🏠 IQHomes server running on http://localhost:${PORT}`);
  for (const line of hardware.summary(PORT)) console.log(line);
  if (firstRun) {
    console.log(`👑 First run: owner PIN is ${DEFAULT_PINS.owner}, family PIN is ${DEFAULT_PINS.family}. Change them in the app.`);
  }
});
