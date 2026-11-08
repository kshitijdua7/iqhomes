import type { ActivityEntry, Device, DevicePatch, HomeState, Room, Scene } from './types.js';

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

export const ROOMS: Room[] = [
  { id: 'living', name: 'Living Room', icon: '🛋️' },
  { id: 'kitchen', name: 'Kitchen', icon: '🍳' },
  { id: 'bedroom', name: 'Bedroom', icon: '🛏️' },
  { id: 'office', name: 'Office', icon: '💻' },
  { id: 'entrance', name: 'Entrance', icon: '🚪' },
];

export const SCENES: Scene[] = [
  { id: 'movie', name: 'Movie Night', icon: '🎬', description: 'Dim lights, close blinds, TV on' },
  { id: 'morning', name: 'Good Morning', icon: '🌅', description: 'Open blinds, warm lights, 21°' },
  { id: 'night', name: 'Good Night', icon: '🌙', description: 'Everything off, doors locked, garage closed, 18°' },
  { id: 'away', name: 'Away', icon: '🧳', description: 'Lights off, locked, garage closed, eco heating' },
  { id: 'focus', name: 'Focus', icon: '🎯', description: 'Bright cool light in the office' },
];

export function createDevices(): Device[] {
  return [
    { id: 'living-main', name: 'Ceiling Light', room: 'living', type: 'light', on: true, brightness: 80, color: '#ffd9a0', watts: 0 },
    { id: 'living-lamp', name: 'Floor Lamp', room: 'living', type: 'light', on: false, brightness: 60, color: '#ffb36b', watts: 0 },
    { id: 'living-blinds', name: 'Window Blinds', room: 'living', type: 'blinds', position: 100, watts: 0 },
    { id: 'living-tv', name: 'TV', room: 'living', type: 'tv', on: false, volume: 20, watts: 0 },
    { id: 'thermostat', name: 'Thermostat', room: 'living', type: 'thermostat', target: 21, current: 19.5, mode: 'auto', watts: 0 },
    { id: 'kitchen-main', name: 'Kitchen Lights', room: 'kitchen', type: 'light', on: true, brightness: 100, color: '#ffffff', watts: 0 },
    { id: 'kitchen-coffee', name: 'Coffee Maker', room: 'kitchen', type: 'plug', on: false, watts: 0 },
    { id: 'kitchen-blinds', name: 'Kitchen Blinds', room: 'kitchen', type: 'blinds', position: 60, watts: 0 },
    { id: 'bedroom-main', name: 'Bedroom Light', room: 'bedroom', type: 'light', on: false, brightness: 40, color: '#ffc68a', watts: 0 },
    { id: 'bedroom-blinds', name: 'Bedroom Blinds', room: 'bedroom', type: 'blinds', position: 0, watts: 0 },
    { id: 'bedroom-fan', name: 'Ceiling Fan', room: 'bedroom', type: 'fan', on: false, speed: 2, watts: 0 },
    { id: 'office-desk', name: 'Desk Light', room: 'office', type: 'light', on: true, brightness: 90, color: '#e6f0ff', watts: 0 },
    { id: 'office-plug', name: 'Monitor Plug', room: 'office', type: 'plug', on: true, watts: 0 },
    { id: 'entrance-light', name: 'Porch Light', room: 'entrance', type: 'light', on: false, brightness: 100, color: '#ffe2b0', watts: 0 },
    { id: 'front-door', name: 'Front Door', room: 'entrance', type: 'lock', locked: true, battery: 87, watts: 0 },
  ];
}

/** Realistic-ish power draw for each device, in watts. */
export function powerOf(d: Device): number {
  switch (d.type) {
    case 'light': return d.on ? Math.round(2 + (d.brightness / 100) * 10) : 0.3;
    case 'tv': return d.on ? 95 + d.volume * 0.3 : 0.5;
    case 'fan': return d.on ? 15 * d.speed : 0;
    case 'plug': return d.on ? (d.id.includes('coffee') ? 900 : 45) : 0.2;
    case 'thermostat': {
      if (d.mode === 'off') return 1;
      const gap = Math.abs(d.target - d.current);
      return gap > 0.3 ? 1500 : 60; // heating/cooling hard vs. just idling
    }
    case 'blinds': return 0.5;
    case 'lock': return 0.1;
    case 'garage': return 2;
  }
}

let idCounter = 0;
const newId = () => `${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

/** Fields each device type is allowed to change, and how to sanitize them. */
const SANITIZERS: Record<string, (v: unknown) => unknown> = {
  on: (v) => Boolean(v),
  locked: (v) => Boolean(v),
  open: (v) => Boolean(v),
  brightness: (v) => clamp(Number(v), 1, 100),
  position: (v) => clamp(Number(v), 0, 100),
  target: (v) => clamp(Number(v), 10, 30),
  speed: (v) => clamp(Number(v), 1, 3),
  volume: (v) => clamp(Number(v), 0, 100),
  color: (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined),
  mode: (v) => (['heat', 'cool', 'auto', 'off'].includes(String(v)) ? v : undefined),
};

export class Home {
  state: HomeState;

  constructor(saved?: Partial<HomeState>) {
    this.state = {
      rooms: ROOMS,
      scenes: SCENES,
      // hardware links are live-only: they're re-established when the board/plug reconnects
      devices: (saved?.devices ?? createDevices()).map(({ hardware: _hw, ...d }) => d as Device),
      activity: saved?.activity ?? [],
      energy: [],
      outsideTemp: 6,
    };
    this.recalcPower();
  }

  device(id: string) { return this.state.devices.find((d) => d.id === id); }

  /** Adds a device linked from the app (e.g. a Kasa switch). */
  addDevice(d: Device) {
    this.state.devices.push(d);
    this.recalcPower();
    this.log('system', `➕ ${d.name} added to ${this.state.rooms.find((r) => r.id === d.room)?.name ?? d.room}`);
  }

  /** Removes a device that was added from the app. Built-in demo devices can't be removed. */
  removeDevice(id: string): Device | undefined {
    const d = this.device(id);
    if (!d?.integration) return undefined;
    this.state.devices = this.state.devices.filter((x) => x.id !== id);
    this.log('system', `➖ ${d.name} removed`);
    return d;
  }

  log(source: ActivityEntry['source'], text: string, by?: string) {
    this.state.activity.unshift({ id: newId(), time: Date.now(), source, text, ...(by ? { by } : {}) });
    this.state.activity.length = Math.min(this.state.activity.length, 60);
  }

  /** Apply a batch of changes. Unknown devices/fields are ignored, numbers are clamped. Returns devices that changed. */
  apply(patches: DevicePatch[], source: ActivityEntry['source'] = 'app', note?: string, by?: string): Device[] {
    const changed: Device[] = [];
    for (const { id, changes } of patches) {
      const d = this.device(id) as unknown as Record<string, unknown> | undefined;
      if (!d) continue;
      let touched = false;
      for (const [key, raw] of Object.entries(changes)) {
        if (!(key in d) || !SANITIZERS[key]) continue;
        const value = SANITIZERS[key](raw);
        if (value === undefined || Number.isNaN(value)) continue;
        if (d[key] !== value) { d[key] = value; touched = true; }
      }
      if (touched) changed.push(d as unknown as Device);
    }
    if (changed.length) {
      this.recalcPower();
      this.log(source, note ?? describeChange(changed), by);
    }
    return changed;
  }

  /** Each scene is just a list of patches built from the current devices. */
  scenePatches(sceneId: string): DevicePatch[] {
    const ds = this.state.devices;
    const all = (type: string, changes: Record<string, unknown>) =>
      ds.filter((d) => d.type === type).map((d) => ({ id: d.id, changes }));
    switch (sceneId) {
      case 'movie': return [
        ...all('light', { on: false }),
        { id: 'living-lamp', changes: { on: true, brightness: 15, color: '#7b5cff' } },
        { id: 'living-blinds', changes: { position: 0 } },
        { id: 'living-tv', changes: { on: true, volume: 30 } },
      ];
      case 'morning': return [
        ...all('blinds', { position: 100 }),
        { id: 'kitchen-main', changes: { on: true, brightness: 100, color: '#ffffff' } },
        { id: 'bedroom-main', changes: { on: true, brightness: 60, color: '#ffc68a' } },
        { id: 'kitchen-coffee', changes: { on: true } },
        { id: 'thermostat', changes: { target: 21, mode: 'auto' } },
      ];
      case 'night': return [
        ...all('light', { on: false }), ...all('blinds', { position: 0 }), ...all('lock', { locked: true }),
        ...all('tv', { on: false }), { id: 'kitchen-coffee', changes: { on: false } },
        ...all('garage', { open: false }),
        { id: 'thermostat', changes: { target: 18 } },
      ];
      case 'away': return [
        ...all('light', { on: false }), ...all('lock', { locked: true }), ...all('tv', { on: false }),
        ...all('fan', { on: false }), ...all('plug', { on: false }), ...all('garage', { open: false }),
        { id: 'thermostat', changes: { target: 16 } },
      ];
      case 'focus': return [
        { id: 'office-desk', changes: { on: true, brightness: 100, color: '#e6f0ff' } },
        { id: 'office-plug', changes: { on: true } },
        { id: 'living-tv', changes: { on: false } },
      ];
      default: return [];
    }
  }

  runScene(sceneId: string, source: ActivityEntry['source'] = 'scene', by?: string) {
    const scene = this.state.scenes.find((s) => s.id === sceneId);
    if (!scene) return [];
    return this.apply(this.scenePatches(sceneId), source, `${scene.icon} Scene "${scene.name}" activated`, by);
  }

  recalcPower() {
    for (const d of this.state.devices) {
      // A real smart plug that measures its own power wins over the estimate.
      const measured = d.hardware?.online ? d.hardware.telemetry?.watts : undefined;
      d.watts = Math.round((measured ?? powerOf(d)) * 10) / 10;
    }
  }

  totalWatts() { return Math.round(this.state.devices.reduce((s, d) => s + d.watts, 0)); }

  /** Called every couple of seconds: indoor temperature drifts toward the target, energy history grows. */
  tick() {
    const t = this.state.devices.find((d) => d.type === 'thermostat');
    if (t && t.type === 'thermostat') {
      const goal = t.mode === 'off' ? this.state.outsideTemp + 10 : t.target;
      const step = (goal - t.current) * 0.08;
      t.current = Math.round((t.current + step) * 10) / 10;
    }
    this.recalcPower();
    this.state.energy.push({ time: Date.now(), watts: this.totalWatts() });
    if (this.state.energy.length > 90) this.state.energy.shift();
  }
}

function describeChange(devices: Device[]): string {
  if (devices.length > 1) return `Updated ${devices.length} devices`;
  const d = devices[0];
  switch (d.type) {
    case 'light': return `${d.name} ${d.on ? `on at ${d.brightness}%` : 'turned off'}`;
    case 'blinds': return `${d.name} ${d.position === 0 ? 'closed' : d.position === 100 ? 'opened' : `set to ${d.position}%`}`;
    case 'thermostat': return `Thermostat set to ${d.target}° (${d.mode})`;
    case 'lock': return `${d.name} ${d.locked ? 'locked' : 'unlocked'}`;
    case 'fan': return `${d.name} ${d.on ? `on, speed ${d.speed}` : 'off'}`;
    case 'tv': return `${d.name} ${d.on ? `on, volume ${d.volume}` : 'off'}`;
    case 'plug': return `${d.name} ${d.on ? 'on' : 'off'}`;
    case 'garage': return `${d.name} ${d.open ? 'opened' : 'closed'}`;
  }
}
