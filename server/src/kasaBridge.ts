import { randomBytes } from 'node:crypto';
import { authHashes, discover, KasaAuthError, KasaDevice, probe, type Discovered, type KasaInfo } from './kasa.js';
import type { HardwareEvents } from './hardware.js';
import type { Device, Light, Plug } from './types.js';

/** Saved Kasa account (hashes only) – lives in server/data/kasa.json, which is git-ignored. */
export interface KasaConfig { email?: string; hashes?: { v1: string; v2: string } }

const POLL_MS = 3_000;

/**
 * Keeps Kasa switches and the virtual house in sync:
 *  - dashboard / Nova change → sent to the switch
 *  - switch flipped by hand or in the Kasa app → picked up by polling and pushed to every screen
 */
export class KasaBridge {
  private clients = new Map<string, KasaDevice>(); // device id -> client
  private failures = new Map<string, number>();
  private polling = false;

  constructor(
    private devices: () => Device[],
    public config: KasaConfig,
    private saveConfig: () => void,
    private events: HardwareEvents,
  ) {
    for (const d of this.linked()) d.hardware = { kind: 'kasa', online: false };
    setInterval(() => void this.poll(), POLL_MS).unref();
    void this.poll();
  }

  get connected() { return !!this.config.hashes; }

  setAccount(email: string, password: string) {
    this.config = { email, hashes: authHashes({ username: email, password }) };
    this.clients.clear(); // reconnect with the new login
    this.saveConfig();
  }

  clearAccount() {
    this.config = {};
    this.clients.clear();
    this.saveConfig();
  }

  /** Scan the Wi-Fi for Kasa devices, marking ones that are already in the house. */
  async scan(): Promise<(Discovered & { added?: string })[]> {
    const found = await discover();
    return found.map((f) => ({ ...f, added: this.linked().find((d) => sameDevice(d, f))?.name }));
  }

  /** Connect to one device by IP and read its name and state. */
  probe(host: string): Promise<KasaInfo> {
    return probe(host.trim(), this.hashList());
  }

  /** Builds the dashboard device for a switch the owner chose to add. */
  createDevice(info: KasaInfo, name: string, room: string, kind: 'light' | 'plug'): Device {
    const id = `kasa-${(info.mac ?? randomBytes(4).toString('hex')).replace(/[^a-z0-9]/gi, '').toLowerCase().slice(-8)}`;
    const integration = { kind: 'kasa' as const, host: info.host, protocol: info.protocol, mac: info.mac, model: info.model };
    const hardware = { kind: 'kasa' as const, online: true, lastSeen: Date.now() };
    const base = { id, name: name.trim().slice(0, 32) || info.alias, room, watts: 0, integration, hardware };
    return kind === 'light'
      ? ({ ...base, type: 'light', on: info.on, brightness: 100, color: '#ffd9a0', dimmable: false } satisfies Light)
      : ({ ...base, type: 'plug', on: info.on } satisfies Plug);
  }

  forget(id: string) { this.clients.delete(id); this.failures.delete(id); }

  /** Push dashboard changes out to the real switches. */
  sync(changed: Device[]) {
    for (const d of changed) {
      if (d.integration?.kind !== 'kasa' || !('on' in d)) continue;
      const on = d.on;
      this.client(d).setOn(on).then(() => this.markOnline(d)).catch((e) => this.markOffline(d, e));
    }
  }

  private async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      await Promise.all(this.linked().map(async (d) => {
        try {
          const info = await this.client(d).info();
          this.markOnline(d);
          if ('on' in d && info.on !== d.on) {
            this.events.report({ id: d.id, changes: { on: info.on } }, `🔘 ${d.name} switched ${info.on ? 'on' : 'off'} at the switch`);
          }
        } catch (e) {
          this.markOffline(d, e);
        }
      }));
    } finally {
      this.polling = false;
    }
  }

  private client(d: Device) {
    const integ = d.integration!;
    let c = this.clients.get(d.id);
    if (!c || c.host !== integ.host) {
      c = new KasaDevice(integ.host, integ.protocol, this.hashList());
      this.clients.set(d.id, c);
    }
    return c;
  }

  private markOnline(d: Device) {
    this.failures.delete(d.id);
    const was = d.hardware?.online;
    d.hardware = { kind: 'kasa', online: true, lastSeen: Date.now() };
    if (!was) this.events.status();
  }

  /** Two misses in a row before showing offline, so one dropped Wi-Fi packet doesn't flash the badge. */
  private markOffline(d: Device, e: unknown) {
    const n = (this.failures.get(d.id) ?? 0) + 1;
    this.failures.set(d.id, n);
    this.clients.delete(d.id); // fresh handshake next time
    if (n === 1 && !(e instanceof KasaAuthError)) return;
    if (d.hardware?.online !== false) {
      d.hardware = { kind: 'kasa', online: false, lastSeen: d.hardware?.lastSeen };
      this.events.status();
    }
    if (n === 3) void this.relocate(d); // maybe the router gave it a new IP
  }

  /** If a switch went quiet, look for it on the network by MAC address and update its IP. */
  private async relocate(d: Device) {
    if (!d.integration?.mac) return;
    const hit = (await discover()).find((f) => sameMac(f.mac, d.integration!.mac));
    if (hit && hit.host !== d.integration.host) {
      d.integration.host = hit.host;
      this.clients.delete(d.id);
      this.events.status();
    }
  }

  private linked() { return this.devices().filter((d) => d.integration?.kind === 'kasa'); }
  private hashList() { return this.config.hashes ? [this.config.hashes] : []; }
}

const sameMac = (a?: string, b?: string) => !!a && !!b && a.replace(/[^a-f0-9]/gi, '').toLowerCase() === b.replace(/[^a-f0-9]/gi, '').toLowerCase();
const sameDevice = (d: Device, f: Discovered) => sameMac(d.integration?.mac, f.mac) || d.integration?.host === f.host;
