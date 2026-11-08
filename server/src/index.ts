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
import { matchSkill, describeTimers, fmtDuration } from './skills.js';
import { askBrain, aiEnabled, remember } from './brain.js';
import { getWeather, weatherSentence } from './weather.js';
import { frenchToEnglish } from './french.js';
import { Security } from './security.js';
import { Storage } from './storage.js';
import { MqttBridge } from './mqttBridge.js';
import { TEMPLATES, describe as describeAutomation, dueByChange, dueByClock, dueBySecurity, validAutomation, type Automation } from './automations.js';
import { Auth, DEFAULT_PINS, canControl, canManagePeople, canRunScenes, filterPatches, toPublic, type StoredUser } from './auth.js';
import { Hardware, plugsFromEnv } from './hardware.js';
import { Push, type Alert } from './push.js';
import { KasaBridge, type KasaConfig } from './kasaBridge.js';
import { HubspaceBridge, type HubspaceConfig } from './hubspaceBridge.js';
import type { Device, DevicePatch, HomeState, KasaIntegration, Lock } from './types.js';

const PORT = Number(process.env.PORT ?? 4000);
const DOOR_REMINDER_MIN = Number(process.env.DOOR_REMINDER_MIN ?? 10);
/** Public demo: one-tap logins, account changes locked, and the whole house resets every hour. */
const DEMO = /^(1|true|yes)$/i.test(process.env.DEMO_MODE ?? '');
const DEMO_RESET_MIN = Number(process.env.DEMO_RESET_MIN ?? 60);
let demoResetAt = Date.now() + DEMO_RESET_MIN * 60_000;
const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR ?? join(here, '..', 'data');
const WEB_DIST = join(here, '..', '..', 'web', 'dist');

// ---- Persistence: JSON files in server/data (git-ignored), or PostgreSQL when DATABASE_URL is set ----
const storage = new Storage(DATA_DIR);
await storage.init();
const load = <T,>(name: string) => storage.load<T>(name);
const persist = (name: string, data: () => unknown) => storage.save(name, data);
let mqttBridge: MqttBridge | undefined; // created below; broadcast() may run before then

const home = new Home(load('state.json'));
const saveHome = () => persist('state.json', () => ({
  devices: home.state.devices.map(({ hardware: _hw, ...d }) => d),
  activity: home.state.activity,
  timers: home.state.timers,
  routines: home.state.routines,
  security: { ...home.state.security, alarm: undefined },
  usage: home.state.usage,
  rooms: home.state.rooms,
  automations: home.state.automations,
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

const hardwareEvents = {
  report(patch: DevicePatch, note: string) {
    const changed = home.apply([patch], 'hardware', note);
    if (changed.length) afterChange(changed, undefined);
  },
  status() { watchHardware(); broadcast(); },
};
const kasa: KasaBridge = new KasaBridge(() => home.state.devices, load<KasaConfig>('kasa.json') ?? {},
  () => persist('kasa.json', () => kasa.config), hardwareEvents);
mqttBridge = new MqttBridge(() => home.state.devices, (patch) => {
  const changed = home.apply([patch], 'hardware', undefined);
  if (changed.length) afterChange(changed, undefined);
});
const hubspace: HubspaceBridge = new HubspaceBridge(() => home.state.devices, load<HubspaceConfig>('hubspace.json') ?? {},
  () => persist('hubspace.json', () => hubspace.config), hardwareEvents);

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
  mqttBridge?.publish();
  for (const s of io.sockets.sockets.values()) {
    const user = auth.userFor(s.data.token);
    if (!user) { s.emit('session:expired'); s.disconnect(true); continue; }
    s.emit('state', viewFor(user));
  }
  saveHome();
}

/** Runs after any real change: push it to hardware, raise alerts, update every screen. */
const security: Security = new Security(home, {
  alert(title, body, urgency, roles = ['owner', 'family']) {
    io.emit('announce', { text: `${title}. ${body}`, kind: urgency === 'alarm' ? 'danger' : urgency === 'warn' ? 'warning' : 'info', ring: urgency === 'alarm' });
    void push.send({ title, body, tag: `security-${title}`, url: '/' }, roles);
    home.log('system', title);
    broadcast();
  },
  apply(patches, note) {
    const changed = home.apply(patches, 'system', note);
    if (changed.length) afterChange(changed, undefined);
  },
});
const setSecurityMode = security.setMode.bind(security);
security.setMode = (mode, by) => {
  const reply = setSecurityMode(mode, by);
  const auto = dueBySecurity(home.state.automations, mode, home.state);
  if (auto.length) setImmediate(() => runAutomations(auto));
  return reply;
};
home.sceneHook = (sceneId, by) => {
  if (sceneId === 'away' && home.state.security.mode !== 'away') security.setMode('away', by);
  if (sceneId === 'night' && home.state.security.mode === 'disarmed') security.setMode('home', by);
  if (sceneId === 'morning' && home.state.security.mode === 'home') security.setMode('disarmed', by);
};

/** Runs automations through Nova's normal parser, as the house itself. */
function runAutomations(list: Automation[]) {
  for (const a of list) {
    a.lastRun = Date.now();
    const r = interpret(a.then, home.state);
    const changed: Device[] = [];
    for (const sc of r.scenes) changed.push(...home.runScene(sc, 'scene'));
    if (r.patches.length) changed.push(...home.apply(r.patches, 'scene', `⚙️ ${a.name}`));
    if (changed.length) afterChange(changed, undefined);
    else home.log('scene', `⚙️ ${a.name} (nothing to change)`);
  }
}

function afterChange(changed: Device[], by: StoredUser | undefined) {
  hardware.sync(changed);
  const auto = dueByChange(home.state.automations, changed, home.state);
  if (auto.length) setImmediate(() => runAutomations(auto));
  for (const d of changed) if (d.type === 'sensor') security.onSensor(d);
  kasa.sync(changed);
  hubspace.sync(changed);
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
    if (prev === d.hardware.online || (prev === undefined && !d.hardware.online)) continue;
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
app.get('/api/demo', (_req, res) => res.json(DEMO ? { demo: true, resetsAt: demoResetAt, pins: DEFAULT_PINS } : { demo: false }));
/** In demo mode, nobody can change PINs, link real accounts or see hardware tokens. */
const blockInDemo = (_req: Request, res: Response, next: NextFunction) => {
  if (DEMO) { res.status(403).json({ error: 'Disabled in the public demo.' }); return; }
  next();
};
app.use(['/api/me/pin', '/api/kasa/account', '/api/hubspace/account', '/api/hardware'], blockInDemo);
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

// ---- Kasa switches (owner only) ----
const kasaError = (res: Response, e: unknown) => res.status(400).json({ error: e instanceof Error ? e.message : 'Something went wrong' });

app.get('/api/kasa', requireUser, requireOwner, (_req, res) => res.json({
  connected: kasa.connected,
  email: kasa.config.email,
  devices: home.state.devices.filter((d) => d.integration?.kind === 'kasa')
    .map((d) => { const i = d.integration as KasaIntegration; return { id: d.id, name: d.name, room: d.room, host: i.host, model: i.model, online: !!d.hardware?.online }; }),
}));

app.post('/api/kasa/account', requireUser, requireOwner, (req, res) => {
  const email = String(req.body?.email ?? '').trim(), password = String(req.body?.password ?? '');
  if (!email || !password) { res.status(400).json({ error: 'Enter the email and password you use in the Kasa app.' }); return; }
  kasa.setAccount(email, password);
  res.json({ ok: true });
});
app.delete('/api/kasa/account', requireUser, requireOwner, (_req, res) => { kasa.clearAccount(); res.json({ ok: true }); });

app.post('/api/kasa/scan', requireUser, requireOwner, async (_req, res) => {
  try { res.json(await kasa.scan()); } catch (e) { kasaError(res, e); }
});

app.post('/api/kasa/probe', requireUser, requireOwner, async (req, res) => {
  const host = String(req.body?.host ?? '').trim();
  if (!/^[\w.-]+(:\d+)?$/.test(host)) { res.status(400).json({ error: 'That doesn’t look like an IP address.' }); return; }
  try { res.json(await kasa.probe(host)); } catch (e) { kasaError(res, e); }
});

app.post('/api/kasa/devices', requireUser, requireOwner, async (req, res) => {
  const { host, name, room, kind } = req.body ?? {};
  if (!home.state.rooms.some((r) => r.id === room)) { res.status(400).json({ error: 'Pick a room.' }); return; }
  try {
    const info = await kasa.probe(String(host));
    const device = kasa.createDevice(info, String(name ?? ''), String(room), kind === 'plug' ? 'plug' : 'light');
    if (home.device(device.id)) { res.status(409).json({ error: `That switch is already added as "${home.device(device.id)!.name}".` }); return; }
    home.addDevice(device);
    watchHardware();
    broadcast();
    res.json({ ok: true, device: { id: device.id, name: device.name } });
  } catch (e) { kasaError(res, e); }
});

app.patch('/api/kasa/devices/:id', requireUser, requireOwner, (req, res) => {
  const d = home.device(String(req.params.id));
  if (!d?.integration) { res.status(404).json({ error: 'No such switch.' }); return; }
  if (typeof req.body?.name === 'string' && req.body.name.trim()) d.name = req.body.name.trim().slice(0, 32);
  if (home.state.rooms.some((r) => r.id === req.body?.room)) d.room = req.body.room;
  broadcast();
  res.json({ ok: true });
});

app.delete('/api/kasa/devices/:id', requireUser, requireOwner, (req, res) => {
  const d = home.removeDevice(String(req.params.id));
  if (!d) { res.status(404).json({ error: 'No such switch.' }); return; }
  kasa.forget(d.id);
  broadcast();
  res.json({ ok: true });
});

// ---- Hubspace (owner only) ----
app.get('/api/hubspace', requireUser, requireOwner, (_req, res) => res.json({
  connected: hubspace.connected,
  expired: !!hubspace.config.expired,
  email: hubspace.config.email,
  devices: home.state.devices.filter((d) => d.integration?.kind === 'hubspace')
    .map((d) => ({ id: d.id, name: d.name, room: d.room, model: d.integration?.model, online: !!d.hardware?.online })),
}));

app.post('/api/hubspace/account', requireUser, requireOwner, async (req, res) => {
  const email = String(req.body?.email ?? '').trim(), password = String(req.body?.password ?? '');
  if (!email || !password) { res.status(400).json({ error: 'Enter the email and password you use in the Hubspace app.' }); return; }
  try { await hubspace.signIn(email, password); res.json({ ok: true }); }
  catch (e) { console.error('Hubspace sign-in failed:', e); kasaError(res, e); }
});
app.delete('/api/hubspace/account', requireUser, requireOwner, (_req, res) => { hubspace.signOut(); res.json({ ok: true }); });

app.get('/api/hubspace/available', requireUser, requireOwner, async (_req, res) => {
  try { res.json(await hubspace.list()); } catch (e) { console.error('Hubspace list failed:', e); kasaError(res, e); }
});

app.post('/api/hubspace/devices', requireUser, requireOwner, async (req, res) => {
  const { hubId, name, room, kind } = req.body ?? {};
  if (!home.state.rooms.some((r) => r.id === room)) { res.status(400).json({ error: 'Pick a room.' }); return; }
  try {
    const device = await hubspace.createDevice(String(hubId), String(name ?? ''), String(room), kind === 'plug' ? 'plug' : 'light');
    if (home.device(device.id)) { res.status(409).json({ error: `Already added as "${home.device(device.id)!.name}".` }); return; }
    home.addDevice(device);
    watchHardware();
    broadcast();
    res.json({ ok: true, device: { id: device.id, name: device.name } });
  } catch (e) { kasaError(res, e); }
});

app.delete('/api/hubspace/devices/:id', requireUser, requireOwner, (req, res) => {
  const d = home.removeDevice(String(req.params.id));
  if (!d) { res.status(404).json({ error: 'No such device.' }); return; }
  broadcast();
  res.json({ ok: true });
});

// ---- Device manager: rooms + devices (owner) ----
const VIRTUAL_DEFAULTS: Record<string, Record<string, unknown>> = {
  light: { on: false, brightness: 80, color: '#ffd9a0' }, blinds: { position: 100 }, fan: { on: false, speed: 2 },
  plug: { on: false }, tv: { on: false, volume: 20 }, lock: { locked: true, battery: 100 }, garage: { open: false },
  sensor: { kind: 'motion', triggered: false, battery: 100 },
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'item';

app.post('/api/rooms', requireUser, requireOwner, (req, res) => {
  const name = String(req.body?.name ?? '').trim().slice(0, 24);
  if (!name) { res.status(400).json({ error: 'Give the room a name.' }); return; }
  let id = slug(name); while (home.state.rooms.some((r) => r.id === id)) id += '-2';
  home.state.rooms.push({ id, name, icon: String(req.body?.icon ?? '🏠').slice(0, 4) });
  home.log('system', `➕ Room "${name}" added`, (req as Authed).user.name);
  broadcast(); res.json({ ok: true, id });
});
app.patch('/api/rooms/:id', requireUser, requireOwner, (req, res) => {
  const r = home.state.rooms.find((x) => x.id === req.params.id);
  if (!r) { res.status(404).json({ error: 'No such room.' }); return; }
  if (typeof req.body?.name === 'string' && req.body.name.trim()) r.name = req.body.name.trim().slice(0, 24);
  if (typeof req.body?.icon === 'string' && req.body.icon) r.icon = req.body.icon.slice(0, 4);
  broadcast(); res.json({ ok: true });
});
app.delete('/api/rooms/:id', requireUser, requireOwner, (req, res) => {
  const id = String(req.params.id);
  if (home.state.devices.some((d) => d.room === id)) { res.status(400).json({ error: 'Move or delete the devices in this room first.' }); return; }
  if (home.state.rooms.length <= 1) { res.status(400).json({ error: 'The house needs at least one room.' }); return; }
  home.state.rooms = home.state.rooms.filter((r) => r.id !== id);
  broadcast(); res.json({ ok: true });
});

app.post('/api/devices', requireUser, requireOwner, (req, res) => {
  const { type, name, room, kind } = req.body ?? {};
  if (!VIRTUAL_DEFAULTS[type]) { res.status(400).json({ error: 'Pick a device type.' }); return; }
  if (!home.state.rooms.some((r) => r.id === room)) { res.status(400).json({ error: 'Pick a room.' }); return; }
  const clean = String(name ?? '').trim().slice(0, 32);
  if (!clean) { res.status(400).json({ error: 'Give the device a name.' }); return; }
  let id = `${room}-${slug(clean)}`; while (home.device(id)) id += '-2';
  const extra = type === 'sensor' && ['motion', 'contact', 'smoke', 'co', 'leak'].includes(kind) ? { kind } : {};
  home.addDevice({ id, name: clean, room, type, watts: 0, custom: true, ...VIRTUAL_DEFAULTS[type], ...extra } as unknown as Device);
  broadcast(); res.json({ ok: true, id });
});
app.patch('/api/devices/:id', requireUser, requireOwner, (req, res) => {
  const d = home.device(String(req.params.id));
  if (!d) { res.status(404).json({ error: 'No such device.' }); return; }
  if (typeof req.body?.name === 'string' && req.body.name.trim()) { d.name = req.body.name.trim().slice(0, 32); d.custom = true; }
  if (home.state.rooms.some((r) => r.id === req.body?.room)) d.room = req.body.room;
  broadcast(); res.json({ ok: true });
});
app.delete('/api/devices/:id', requireUser, requireOwner, (req, res) => {
  const d = home.removeDevice(String(req.params.id), true);
  if (!d) { res.status(404).json({ error: 'No such device.' }); return; }
  home.state.automations = home.state.automations.filter((a) => !JSON.stringify(a).includes(`"${d.id}"`));
  broadcast(); res.json({ ok: true });
});

// ---- Automations (owner + family) ----
const requireAdult = (req: Request, res: Response, next: NextFunction) => {
  if ((req as Authed).user.role === 'guest') { res.status(403).json({ error: 'Guests can’t change automations.' }); return; }
  next();
};
app.get('/api/automations/templates', requireUser, (_req, res) => res.json(TEMPLATES));
app.post('/api/automations', requireUser, requireAdult, (req, res) => {
  if (!validAutomation(req.body)) { res.status(400).json({ error: 'That automation is missing something.' }); return; }
  const test = interpret(req.body.then, home.state);
  if (!test.patches.length && !test.scenes.length) { res.status(400).json({ error: `Nova didn't understand "${req.body.then}". Try something like "turn on the porch light".` }); return; }
  const a: Automation = {
    id: `a${Date.now().toString(36)}`, name: String(req.body.name ?? '').trim().slice(0, 40) || 'My automation', enabled: true,
    trigger: req.body.trigger, conditions: req.body.conditions, then: req.body.then.trim(), createdBy: (req as Authed).user.name,
  };
  home.state.automations.push(a);
  home.log('system', `⚙️ Automation "${a.name}" created`, (req as Authed).user.name);
  broadcast(); res.json({ ok: true, id: a.id, description: describeAutomation(a, home.state) });
});
app.patch('/api/automations/:id', requireUser, requireAdult, (req, res) => {
  const a = home.state.automations.find((x) => x.id === req.params.id);
  if (!a) { res.status(404).json({ error: 'No such automation.' }); return; }
  if (typeof req.body?.enabled === 'boolean') a.enabled = req.body.enabled;
  if (req.body?.run === true) runAutomations([a]);
  broadcast(); res.json({ ok: true });
});
app.delete('/api/automations/:id', requireUser, requireAdult, (req, res) => {
  home.state.automations = home.state.automations.filter((x) => x.id !== req.params.id);
  broadcast(); res.json({ ok: true });
});

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
/** Topics a guest can't even ask about, because their pass hides those devices. */
const GUEST_PRIVATE = /\b(garage|lock|locked|unlock|door|doors|thermostat|temperature|heat|heating|cool|cooling|degrees?|cold|warm|hot|energy|power|watts?|bill)\b/;

function askDevices(user: StoredUser, text: string) {
  if (user.role !== 'guest') {
    const result = interpret(text, home.state);
    const changed: Device[] = [];
    for (const s of result.scenes) changed.push(...home.runScene(s, 'voice', user.name));
    if (result.patches.length) changed.push(...home.apply(result.patches, 'voice', `🎙️ "${text.trim()}"`, user.name));
    if (changed.length) afterChange(changed, user);
    return result;
  }

  // Guests: understand the request against the whole house only to name what was refused,
  // but act and reply using just the devices their pass covers.
  const full = interpret(text, home.state);
  const { denied } = filterPatches(user, full.patches, home.state.devices);
  // every room/scene name stays known (so "kitchen" is understood), but only their devices can be acted on
  const mine = interpret(text, { ...home.state, devices: viewFor(user).devices });
  const refusedScene = full.scenes.length > 0;
  const nothingToDo = !mine.patches.length;

  if (nothingToDo && (denied.length || refusedScene || GUEST_PRIVATE.test(text.toLowerCase()))) {
    const what = denied.length ? denied.map((d) => d.name).join(', ') : refusedScene ? 'whole-house scenes' : 'that';
    return { understood: false, reply: `Sorry ${user.name}, your guest pass doesn't cover ${what}.`, patches: [], scenes: [] };
  }

  const { allowed } = filterPatches(user, mine.patches, home.state.devices); // belt and braces
  if (allowed.length) {
    const changed = home.apply(allowed, 'voice', `🎙️ "${text.trim()}"`, user.name);
    if (changed.length) afterChange(changed, user);
  }
  const skipped = denied.length ? ` (${denied.map((d) => d.name).join(', ')} ${denied.length > 1 ? 'aren’t' : 'isn’t'} on your guest pass.)` : '';
  return { ...mine, scenes: [], patches: allowed, reply: mine.reply + skipped };
}

type AskResult = { understood: boolean; reply: string; patches: DevicePatch[]; scenes: string[]; ai?: boolean };

/**
 * Everything Nova can do, in order:
 *   1. skills (routines, announcements, timers/alarms/reminders, weather)
 *   2. the built-in device parser (fast, free, offline)
 *   3. the AI brain, only if 1 and 2 didn't understand (and an API key is set)
 * The morning briefing is added to "good morning".
 */
async function ask(user: StoredUser, rawText: string, lang: 'en' | 'fr' = 'en'): Promise<AskResult> {
  const original = rawText.trim();
  // Without the AI brain, French is translated to English first; with it, the AI gets the original French.
  const text = lang === 'fr' ? frenchToEnglish(original) : original;
  const ok = (reply: string): AskResult => { remember(user.name, text, reply); return { understood: true, reply, patches: [], scenes: [] }; };
  const isGuest = user.role === 'guest';
  const skill = matchSkill(text, home.state, user.name);

  if (skill) {
    switch (skill.kind) {
      case 'defineRoutine': {
        if (isGuest) return ok('Sorry, guests can’t create routines.');
        const test = interpret(skill.actions, home.state);
        if (!test.patches.length && !test.scenes.length) return ok(`I didn't understand what to do for "${skill.phrase}". Try something like: when I say good evening, dim the living room to 40 percent.`);
        home.state.routines = home.state.routines.filter((r) => r.phrase !== skill.phrase);
        home.state.routines.push({ id: `r${Date.now().toString(36)}`, phrase: skill.phrase, actions: skill.actions, createdBy: user.name });
        home.log('system', `✨ New routine "${skill.phrase}" created`, user.name);
        broadcast();
        return ok(`Got it. When you say "${skill.phrase}", I'll ${skill.actions.replace(/^(and )?then /, '')}.`);
      }
      case 'deleteRoutine': {
        if (isGuest) return ok('Sorry, guests can’t change routines.');
        const before = home.state.routines.length;
        home.state.routines = home.state.routines.filter((r) => r.phrase !== skill.phrase);
        if (before === home.state.routines.length) return ok(`I couldn't find a routine called "${skill.phrase}".`);
        broadcast();
        return ok(`Deleted the "${skill.phrase}" routine.`);
      }
      case 'listRoutines':
        return ok(home.state.routines.length ? `Your routines: ${home.state.routines.map((r) => `"${r.phrase}"`).join(', ')}.` : 'You have no custom routines yet. Try: when I say "I\'m home", turn on the porch light.');
      case 'runRoutine': {
        const r = askDevices(user, skill.routine.actions);
        return { ...r, reply: r.understood ? `Running "${skill.routine.phrase}". ${r.reply}` : r.reply };
      }
      case 'announce':
        io.emit('announce', { text: skill.message, from: user.name });
        home.log('system', `📢 "${skill.message}"`, user.name);
        broadcast();
        return ok(`Announcing: ${skill.message}.`);
      case 'timer':
        if (isGuest && skill.item.kind === 'alarm') return ok('Sorry, guests can’t set house alarms.');
        home.state.timers.push(skill.item);
        broadcast();
        return ok(skill.reply);
      case 'cancel': {
        const before = home.state.timers.length;
        home.state.timers = home.state.timers.filter((t) => t.kind !== skill.what || (isGuest && t.createdBy !== user.name));
        const n = before - home.state.timers.length;
        broadcast();
        return ok(n ? `Cancelled ${n === 1 ? `your ${skill.what}` : `${n} ${skill.what}s`}.` : `You don't have any ${skill.what}s to cancel.`);
      }
      case 'list':
        return ok(describeTimers(home.state.timers, skill.what));
      case 'security': {
        if (isGuest) return ok('Sorry, guests can’t change the security system.');
        const reply = security.setMode(skill.mode, user.name);
        broadcast();
        return ok(reply);
      }
      case 'silence': {
        const reply = security.silence(user.name);
        broadcast();
        return ok(reply);
      }
      case 'securityStatus': {
        if (isGuest) return ok('Sorry, that’s not covered by your guest pass.');
        const m = home.state.security.mode;
        return ok(m === 'disarmed' ? 'The security system is off.' : `Yes, it's armed in ${m === 'away' ? 'Away' : 'Home'} mode.`);
      }
      case 'schedule': {
        if (isGuest) return ok('Sorry, guests can’t create schedules.');
        const test = interpret(skill.command, home.state);
        if (!test.patches.length && !test.scenes.length) return ok(`I couldn't work out what to do: "${skill.command}".`);
        const a: Automation = { id: `a${Date.now().toString(36)}`, name: skill.label[0].toUpperCase() + skill.label.slice(1), enabled: true, trigger: skill.trigger, conditions: [], then: skill.command, createdBy: user.name };
        home.state.automations.push(a);
        home.log('system', `🗓️ New schedule: ${a.name}`, user.name);
        broadcast();
        return ok(`Scheduled: ${describeAutomation(a, home.state).replace(/: /, ', I’ll ')}.`);
      }
      case 'weather': {
        const w = await getWeather();
        return ok(w ? weatherSentence(w) : "I can't reach the weather service right now.");
      }
    }
  }

  let result: AskResult = askDevices(user, text);

  // 3. AI fallback when the parser didn't understand
  if (!result.understood && aiEnabled()) {
    const view = isGuest ? { ...home.state, devices: viewFor(user).devices, scenes: [] } : home.state;
    const ai = await askBrain(user.name, original, view, lang);
    if (ai) {
      const { allowed } = filterPatches(user, ai.patches, home.state.devices);
      const scenes = canRunScenes(user) ? ai.scenes : [];
      const changed: Device[] = [];
      for (const sc of scenes) changed.push(...home.runScene(sc, 'voice', user.name));
      if (allowed.length) changed.push(...home.apply(allowed, 'voice', `🧠 "${text}"`, user.name));
      if (changed.length) afterChange(changed, user);
      return { understood: true, reply: ai.reply, patches: allowed, scenes, ai: true };
    }
  } else {
    remember(user.name, text, result.reply);
  }

  // Daily briefing on "good morning"
  if (/\b(good ?morning|daily briefing|brief me|what'?s my day)\b/i.test(text)) {
    const w = await getWeather();
    const today = new Date().toDateString();
    const reminders = home.state.timers.filter((t) => t.kind === 'reminder' && new Date(t.at).toDateString() === today);
    const t = home.state.devices.find((d) => d.type === 'thermostat');
    const open = home.state.devices.filter((d) => (d.type === 'lock' && !d.locked) || (d.type === 'garage' && d.open));
    const parts = [
      `Good morning, ${user.name}!`,
      w ? weatherSentence(w) : '',
      reminders.length ? `Today you asked me to remind you to ${reminders.map((r) => r.label).join(', and ')}.` : '',
      t?.type === 'thermostat' ? `It's ${t.current}° inside.` : '',
      !isGuest && open.length ? `Heads up: the ${open.map((d) => d.name.toLowerCase()).join(' and ')} ${open.length > 1 ? 'are' : 'is'} open.` : '',
    ];
    result = { ...result, understood: true, reply: `${parts.filter(Boolean).join(' ')}${result.scenes.length || result.patches.length ? ' I’ve opened the blinds and started your morning.' : ''}` };
  }
  return result;
}

app.post('/api/assistant', requireUser, async (req, res) => {
  res.json(await ask((req as Authed).user, String(req.body?.text ?? '').slice(0, 300), req.body?.lang === 'fr' ? 'fr' : 'en'));
});
app.get('/api/assistant/status', requireUser, (_req, res) => res.json({ ai: aiEnabled() }));

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

  socket.on('security:set', (mode: string) => {
    const user = current();
    if (!user || user.role === 'guest' || !['disarmed', 'home', 'away'].includes(mode)) return;
    security.setMode(mode as 'disarmed' | 'home' | 'away', user.name);
    broadcast();
  });
  socket.on('security:silence', () => {
    const user = current();
    if (!user) return;
    security.silence(user.name);
    broadcast();
  });
  socket.on('security:presence', (on: boolean) => {
    const user = current();
    if (!user || user.role === 'guest') return;
    home.state.security.presenceSim = Boolean(on);
    broadcast();
  });
  /** Owner demo button: trigger or clear a sensor as if it fired for real. */
  socket.on('sensor:simulate', (id: string, triggered: boolean) => {
    const user = current();
    if (!user || user.role !== 'owner') return;
    const d = home.device(String(id));
    if (d?.type !== 'sensor') return;
    const changed = home.apply([{ id: d.id, changes: { triggered: Boolean(triggered) } }], 'system', `🧪 ${d.name}: ${triggered ? 'simulated trigger' : 'cleared'}`, user.name);
    if (changed.length) afterChange(changed, user);
  });

  socket.on('timer:cancel', (timerId: string) => {
    const user = current();
    if (!user) return;
    const t = home.state.timers.find((x) => x.id === timerId);
    if (!t || (user.role === 'guest' && t.createdBy !== user.name)) return;
    home.state.timers = home.state.timers.filter((x) => x.id !== timerId);
    broadcast();
  });

  socket.on('assistant:ask', async (text: string, langOrReply?: unknown, maybeReply?: (r: unknown) => void) => {
    const user = current();
    if (!user) { socket.emit('session:expired'); return; }
    const reply = typeof langOrReply === 'function' ? langOrReply as (r: unknown) => void : maybeReply;
    const lang = langOrReply === 'fr' ? 'fr' : 'en';
    reply?.(await ask(user, String(text ?? '').slice(0, 300), lang));
  });
});

// ---- Timers, alarms and reminders: check every second ----
setInterval(() => {
  const due = home.state.timers.filter((t) => t.at <= Date.now());
  if (!due.length) return;
  home.state.timers = home.state.timers.filter((t) => t.at > Date.now());
  for (const t of due) {
    const text = t.kind === 'timer'
      ? `${t.label === 'Timer' ? 'Your timer' : `Your ${t.label} timer`} is done${t.duration ? ` (${fmtDuration(t.duration)})` : ''}.`
      : t.kind === 'alarm' ? `⏰ It's ${new Date().toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}. Time to wake up${t.createdBy ? `, ${t.createdBy}` : ''}!`
      : `Reminder${t.createdBy ? ` for ${t.createdBy}` : ''}: ${t.label}.`;
    io.emit('announce', { text, kind: t.kind, ring: true });
    void push.send({ title: t.kind === 'timer' ? '⏲️ Timer done' : t.kind === 'alarm' ? '⏰ Alarm' : '🔔 Reminder', body: text, tag: `timer-${t.id}` }, ['owner', 'family', 'guest']);
    if (t.scene) { const changed = home.runScene(t.scene, 'system'); if (changed.length) afterChange(changed, undefined); }
    home.log('system', text);
  }
  broadcast();
}, 1000).unref();

// ---- Energy history: save + refresh screens every minute ----
setInterval(() => broadcast(), 60_000).unref();

// ---- Demo mode: reset the whole house every hour ----
if (DEMO) {
  setInterval(() => {
    if (Date.now() < demoResetAt) return;
    demoResetAt = Date.now() + DEMO_RESET_MIN * 60_000;
    const fresh = new Home();
    home.state.devices = fresh.state.devices;
    home.state.rooms = fresh.state.rooms;
    home.state.activity = [];
    home.state.timers = [];
    home.state.routines = [];
    home.state.automations = [];
    home.state.security = fresh.state.security;
    home.state.usage = [];
    for (const g of auth.guests()) auth.removeGuest(g.id);
    home.log('system', '🧪 Demo reset: the house is back to its starting state');
    io.emit('announce', { text: 'The demo house was just reset. Have fun!', kind: 'info' });
    broadcast();
  }, 15_000).unref();
}

// ---- Automations and schedules: check the clock every 20 seconds ----
setInterval(() => {
  const due = dueByClock(home.state.automations, home.state);
  if (due.length) runAutomations(due);
}, 20_000).unref();

// ---- Presence simulation while away ----
setInterval(() => security.presenceTick(home.state.weather?.sunset), 60_000).unref();

// ---- Real weather every 10 minutes ----
async function refreshWeather() {
  const w = await getWeather();
  if (!w) return;
  home.state.weather = w;
  home.state.outsideTemp = w.temp;
  broadcast();
}
void refreshWeather();
setInterval(() => void refreshWeather(), 10 * 60_000).unref();

// The simulator: every 2 seconds temperatures drift and the power chart updates on every screen.
setInterval(() => {
  home.tick();
  for (const s of io.sockets.sockets.values()) {
    const user = auth.userFor(s.data.token);
    if (!user) continue;
    const view = viewFor(user);
    s.emit('tick', { devices: view.devices, energy: home.state.energy, tou: home.state.tou });
  }
}, 2000);

// In production, serve the built React app from the same server.
if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get('*', (_req, res) => res.sendFile(join(WEB_DIST, 'index.html')));
}

http.listen(PORT, () => {
  console.log(`🏠 IQHomes server running on http://localhost:${PORT}`);
  console.log(`💾 Storage: ${storage.kind}${DEMO ? ` · 🧪 DEMO MODE (resets every ${DEMO_RESET_MIN} min)` : ''}`);
  for (const line of hardware.summary(PORT)) console.log(line);
  if (firstRun) {
    console.log(`👑 First run: owner PIN is ${DEFAULT_PINS.owner}, family PIN is ${DEFAULT_PINS.family}. Change them in the app.`);
  }
});
