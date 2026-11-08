import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { Home } from './home.js';
import { interpret } from './assistant.js';
import type { DevicePatch } from './types.js';

const PORT = Number(process.env.PORT ?? 4000);
const here = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(here, '..', 'data', 'state.json');
const WEB_DIST = join(here, '..', '..', 'web', 'dist');

// ---- State (saved to a JSON file so the house survives restarts) ----
function load() {
  try { return existsSync(DATA_FILE) ? JSON.parse(readFileSync(DATA_FILE, 'utf8')) : undefined; } catch { return undefined; }
}
const home = new Home(load());
let saveTimer: NodeJS.Timeout | undefined;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    mkdirSync(dirname(DATA_FILE), { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify({ devices: home.state.devices, activity: home.state.activity }, null, 2));
  }, 500);
}
if (!home.state.activity.length) home.log('system', 'IQHomes started');

// ---- HTTP + WebSocket server ----
const app = express();
app.use(cors());
app.use(express.json());
const http = createServer(app);
const io = new Server(http, { cors: { origin: '*' } });

const broadcast = () => { io.emit('state', home.state); save(); };

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/state', (_req, res) => res.json(home.state));
app.post('/api/assistant', (req, res) => res.json(ask(String(req.body?.text ?? ''))));

function ask(text: string) {
  const result = interpret(text, home.state);
  for (const s of result.scenes) home.runScene(s, 'voice');
  if (result.patches.length) home.apply(result.patches, 'voice', `🎙️ "${text.trim()}"`);
  if (result.scenes.length || result.patches.length) broadcast();
  return result;
}

io.on('connection', (socket) => {
  socket.emit('state', home.state);

  socket.on('device:update', (patch: DevicePatch) => {
    if (home.apply([patch]).length) broadcast();
  });

  socket.on('scene:run', (sceneId: string) => {
    if (home.runScene(sceneId).length) broadcast();
  });

  socket.on('assistant:ask', (text: string, reply?: (r: unknown) => void) => {
    const result = ask(String(text ?? '').slice(0, 300));
    reply?.(result);
  });
});

// The simulator: every 2 seconds temperatures drift and the power chart updates on every screen.
setInterval(() => {
  home.tick();
  io.emit('tick', { devices: home.state.devices, energy: home.state.energy });
}, 2000);

// In production, serve the built React app from the same server.
if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get('*', (_req, res) => res.sendFile(join(WEB_DIST, 'index.html')));
}

http.listen(PORT, () => console.log(`🏠 IQHomes server running on http://localhost:${PORT}`));
