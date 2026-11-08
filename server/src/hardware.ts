import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Device, DevicePatch, HardwareInfo } from './types.js';

/**
 * Bridges virtual devices to real ones.
 *
 * ESP32 (or any board that can open a WebSocket) connects to ws://<server>:4000/hardware?token=…
 *   board  → { type: 'hello', device: 'living-lamp' }           claims a dashboard device
 *   server → { type: 'state', on: true, brightness: 60, … }     whenever that device changes
 *   board  → { type: 'button' }                                 physical button pressed: toggle
 *   board  → { type: 'telemetry', tempC: 24.1, rssi: -58 }      live readings shown on the card
 *
 * Wi-Fi smart plugs are driven over their local HTTP API (no cloud account needed):
 *   Shelly Plus / Gen2+:  /rpc/Switch.Set, /rpc/Switch.GetStatus   (also reports real watts)
 *   Tasmota:              /cm?cmnd=Power …, Status 8                (also reports real watts)
 * They are polled every few seconds, so pressing the plug's own button updates every screen too.
 */

export interface PlugConfig { kind: 'shelly' | 'tasmota'; host: string; device: string }

export interface HardwareEvents {
  /** The physical world changed (button press, plug toggled by hand): apply it to the virtual house. */
  report(patch: DevicePatch, note: string): void;
  /** Online/offline or telemetry changed: just re-broadcast. */
  status(): void;
}

const STALE_MS = 15_000;
const POLL_MS = 4_000;

export class Hardware {
  private boards = new Map<string, WebSocket>(); // device id -> socket
  private wss = new WebSocketServer({ noServer: true });

  constructor(
    private devices: () => Device[],
    private token: string,
    private plugs: PlugConfig[],
    private events: HardwareEvents,
  ) {
    for (const p of plugs) this.mark(p.device, { kind: p.kind, online: false });
    if (plugs.length) setInterval(() => this.pollPlugs(), POLL_MS).unref();
    setInterval(() => this.sweep(), 5_000).unref();
    this.pollPlugs();
  }

  /** Attach to the HTTP server's upgrade event. Only /hardware is ours; Socket.io handles its own path. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/hardware') return false;
    if (url.searchParams.get('token') !== this.token) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return true;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onBoard(ws));
    return true;
  }

  private onBoard(ws: WebSocket) {
    let deviceId: string | undefined;
    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg.type === 'hello') {
        const d = this.find(String(msg.device));
        if (!d) { ws.send(JSON.stringify({ type: 'error', error: `Unknown device "${msg.device}"` })); return; }
        deviceId = d.id;
        this.boards.get(d.id)?.close(4000, 'replaced by a newer connection');
        this.boards.set(d.id, ws);
        this.mark(d.id, { kind: 'esp32', online: true, lastSeen: Date.now(), telemetry: d.hardware?.telemetry });
        this.send(d);
        this.events.status();
        return;
      }
      if (!deviceId) return;
      const d = this.find(deviceId);
      if (!d?.hardware) return;
      d.hardware.lastSeen = Date.now();
      if (!d.hardware.online) { d.hardware.online = true; this.events.status(); }

      if (msg.type === 'button' && 'on' in d) {
        this.events.report({ id: d.id, changes: { on: !d.on } }, `🔘 ${d.name} ${d.on ? 'turned off' : 'turned on'} with its physical button`);
      } else if (msg.type === 'telemetry') {
        const readings: Record<string, number> = {};
        for (const [k, v] of Object.entries(msg)) if (k !== 'type' && typeof v === 'number' && Number.isFinite(v)) readings[k] = v;
        d.hardware.telemetry = { ...d.hardware.telemetry, ...readings };
        this.events.status();
      }
    });
    ws.on('close', () => {
      if (!deviceId || this.boards.get(deviceId) !== ws) return;
      this.boards.delete(deviceId);
      const d = this.find(deviceId);
      if (d?.hardware) { d.hardware.online = false; this.events.status(); }
    });
  }

  /** Called after any device change: pushes the new state out to whatever real device backs it. */
  sync(changed: Device[]) {
    for (const d of changed) {
      if (!d.hardware) continue;
      if (d.hardware.kind === 'esp32') this.send(d);
      else {
        const plug = this.plugs.find((p) => p.device === d.id);
        if (plug && 'on' in d) void this.setPlug(plug, d.on);
      }
    }
  }

  /** Short status line for the startup log. */
  summary(port: number): string[] {
    const lines = [`🔌 Hardware: ESP32 boards connect to ws://<this-computer-ip>:${port}/hardware?token=${this.token}`];
    for (const p of this.plugs) lines.push(`🔌 Hardware: ${p.kind} plug at ${p.host} → "${p.device}"`);
    return lines;
  }

  // ---- ESP32 ----

  private send(d: Device) {
    const ws = this.boards.get(d.id);
    if (!ws || ws.readyState !== ws.OPEN) return;
    const { id, name, type, hardware: _hw, watts: _w, room: _r, ...state } = d;
    ws.send(JSON.stringify({ type: 'state', id, name, deviceType: type, ...state }));
  }

  /** Boards that stop talking (unplugged, Wi-Fi dropped) are shown as offline. */
  private sweep() {
    for (const d of this.devices()) {
      const hw = d.hardware;
      if (hw?.kind === 'esp32' && hw.online && Date.now() - (hw.lastSeen ?? 0) > STALE_MS) {
        hw.online = false;
        this.boards.get(d.id)?.terminate();
        this.boards.delete(d.id);
        this.events.status();
      }
    }
  }

  // ---- Smart plugs ----

  private async setPlug(p: PlugConfig, on: boolean) {
    const url = p.kind === 'shelly'
      ? `http://${p.host}/rpc/Switch.Set?id=0&on=${on}`
      : `http://${p.host}/cm?cmnd=${encodeURIComponent(`Power ${on ? 'On' : 'Off'}`)}`;
    try { await fetchJson(url); } catch { this.offline(p.device); }
  }

  private async pollPlugs() {
    await Promise.all(this.plugs.map(async (p) => {
      const d = this.find(p.device);
      if (!d || !('on' in d)) return;
      try {
        let on: boolean, watts: number | undefined;
        if (p.kind === 'shelly') {
          const s = await fetchJson(`http://${p.host}/rpc/Switch.GetStatus?id=0`) as { output: boolean; apower?: number };
          on = s.output; watts = s.apower;
        } else {
          const s = await fetchJson(`http://${p.host}/cm?cmnd=${encodeURIComponent('Status 0')}`) as {
            Status?: { Power?: number | string }; StatusSNS?: { ENERGY?: { Power?: number } };
          };
          const power = s.Status?.Power;
          on = power === 1 || power === '1' || power === 'ON';
          watts = s.StatusSNS?.ENERGY?.Power;
        }
        const wasOffline = !d.hardware?.online;
        d.hardware = { kind: p.kind, online: true, lastSeen: Date.now(), telemetry: watts !== undefined ? { watts } : d.hardware?.telemetry };
        if (on !== d.on) this.events.report({ id: d.id, changes: { on } }, `🔘 ${d.name} switched ${on ? 'on' : 'off'} at the plug`);
        else if (wasOffline || watts !== undefined) this.events.status();
      } catch {
        this.offline(p.device);
      }
    }));
  }

  private offline(id: string) {
    const d = this.find(id);
    if (d?.hardware?.online) { d.hardware.online = false; this.events.status(); }
  }

  private find(id: string) { return this.devices().find((d) => d.id === id); }

  private mark(id: string, info: HardwareInfo) {
    const d = this.find(id);
    if (d) d.hardware = info;
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Reads plug settings from environment variables, e.g. SHELLY_HOST=192.168.0.50 PLUG_DEVICE=kitchen-coffee */
export function plugsFromEnv(env: NodeJS.ProcessEnv): PlugConfig[] {
  const device = env.PLUG_DEVICE ?? 'kitchen-coffee';
  if (env.SHELLY_HOST) return [{ kind: 'shelly', host: env.SHELLY_HOST, device }];
  if (env.TASMOTA_HOST) return [{ kind: 'tasmota', host: env.TASMOTA_HOST, device }];
  return [];
}
