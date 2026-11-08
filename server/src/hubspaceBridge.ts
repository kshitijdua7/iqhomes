import { HubspaceClient, HubspaceError, hubspaceLogin, type HubspaceDevice, type HubspaceTokens } from './hubspace.js';
import type { HardwareEvents } from './hardware.js';
import type { Device, HubspaceIntegration, Light, Plug } from './types.js';

/** Saved Hubspace sign-in – only a refresh token, never the password. Lives in git-ignored server/data/hubspace.json. */
export interface HubspaceConfig { email?: string; tokens?: HubspaceTokens; expired?: boolean }

const POLL_MS = 5_000;
const hubOf = (d: Device) => (d.integration?.kind === 'hubspace' ? d.integration : undefined);

/**
 * Keeps Hubspace devices and the virtual house in sync through the Hubspace cloud:
 *  - dashboard / Nova change → sent to Hubspace → your switch
 *  - switch flipped by hand or in the Hubspace app → picked up by polling and pushed to every screen
 */
export class HubspaceBridge {
  private client?: HubspaceClient;
  private polling = false;
  /** Ignore polled state for a device briefly after we change it, so a slow cloud doesn't flip it back. */
  private recentlySet = new Map<string, number>();

  constructor(
    private devices: () => Device[],
    public config: HubspaceConfig,
    private saveConfig: () => void,
    private events: HardwareEvents,
  ) {
    if (config.tokens) this.client = this.makeClient(config.tokens);
    for (const d of this.linked()) d.hardware = { kind: 'hubspace', online: false };
    setInterval(() => void this.poll(), POLL_MS).unref();
    void this.poll();
  }

  get connected() { return !!this.client && !this.config.expired; }

  async signIn(email: string, password: string) {
    const tokens = await hubspaceLogin(email, password); // password is used here and then dropped
    this.config = { email, tokens };
    this.client = this.makeClient(tokens);
    this.saveConfig();
    void this.poll();
  }

  signOut() {
    this.config = {};
    this.client = undefined;
    this.saveConfig();
  }

  /** Everything on the Hubspace account, marking what's already in the house. */
  async list(): Promise<(HubspaceDevice & { added?: string })[]> {
    const all = await this.api().devices();
    return all.map((h) => ({ ...h, added: this.linked().find((d) => hubOf(d)!.deviceId === h.id)?.name }));
  }

  async createDevice(hubId: string, name: string, room: string, kind: 'light' | 'plug'): Promise<Device> {
    const h = (await this.api().devices()).find((x) => x.id === hubId);
    if (!h) throw new HubspaceError('That device is no longer on your Hubspace account.');
    if (h.on === undefined) throw new HubspaceError(`${h.name} can't be switched on and off, so it can't be added yet.`);
    const integration: HubspaceIntegration = { kind: 'hubspace', deviceId: h.id, powerInstance: h.powerInstance, model: h.model };
    const base = {
      id: `hub-${h.id.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(-10)}`,
      name: name.trim().slice(0, 32) || h.name, room, watts: 0, integration,
      hardware: { kind: 'hubspace' as const, online: h.online !== false, lastSeen: Date.now() },
    };
    return kind === 'light'
      ? ({ ...base, type: 'light', on: h.on, brightness: 100, color: '#ffd9a0', dimmable: false } satisfies Light)
      : ({ ...base, type: 'plug', on: h.on } satisfies Plug);
  }

  sync(changed: Device[]) {
    for (const d of changed) {
      const integ = hubOf(d);
      if (!integ || !('on' in d) || !this.client) continue;
      this.recentlySet.set(d.id, Date.now());
      this.client.setPower(integ.deviceId, d.on, integ.powerInstance)
        .then(() => this.mark(d, true))
        .catch((e) => this.fail(e, d));
    }
  }

  private async poll() {
    if (this.polling || !this.client || this.config.expired || !this.linked().length) return;
    this.polling = true;
    try {
      const remote = await this.client.devices();
      for (const d of this.linked()) {
        const h = remote.find((x) => x.id === hubOf(d)!.deviceId);
        this.mark(d, !!h && h.online !== false);
        if (!h || h.on === undefined || !('on' in d) || h.on === d.on) continue;
        if (Date.now() - (this.recentlySet.get(d.id) ?? 0) < 8_000) continue;
        this.events.report({ id: d.id, changes: { on: h.on } }, `🔘 ${d.name} switched ${h.on ? 'on' : 'off'} (wall switch or Hubspace app)`);
      }
    } catch (e) {
      this.fail(e);
    } finally {
      this.polling = false;
    }
  }

  private fail(e: unknown, d?: Device) {
    if (e instanceof HubspaceError && e.message === 'expired') {
      this.config = { ...this.config, expired: true };
      this.saveConfig();
    }
    for (const x of d ? [d] : this.linked()) this.mark(x, false);
  }

  private mark(d: Device, online: boolean) {
    const was = d.hardware?.online;
    d.hardware = { kind: 'hubspace', online, lastSeen: online ? Date.now() : d.hardware?.lastSeen };
    if (was !== online) this.events.status();
  }

  private api() {
    if (!this.client || this.config.expired) throw new HubspaceError('Sign in to Hubspace first.');
    return this.client;
  }

  private makeClient(tokens: HubspaceTokens) {
    return new HubspaceClient(tokens, (t) => { this.config = { ...this.config, tokens: t }; this.saveConfig(); });
  }

  private linked() { return this.devices().filter((d) => d.integration?.kind === 'hubspace'); }
}
