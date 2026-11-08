// Shared data shapes for the whole smart home.
// The web app keeps a copy of these in web/src/types.ts.

export type DeviceType = 'light' | 'blinds' | 'thermostat' | 'lock' | 'fan' | 'plug' | 'tv' | 'garage' | 'sensor';

export interface BaseDevice {
  id: string;
  name: string;
  room: string;
  type: DeviceType;
  watts: number; // current power draw, recalculated by the simulator
  /** Set when this device is backed by a real physical device (ESP32 or smart plug). */
  hardware?: HardwareInfo;
  /** Saved link to a real smart-home device added from the app (e.g. a Kasa switch). */
  integration?: Integration;
}

export type Integration = KasaIntegration | HubspaceIntegration | MerossIntegration;

export interface KasaIntegration {
  kind: 'kasa';
  host: string;            // IP (and port, if not the default) on the local network
  protocol: 'klap-smart' | 'klap-iot' | 'legacy';
  mac?: string;
  model?: string;
}

export interface MerossIntegration {
  kind: 'meross';
  uuid: string;            // Meross device id
  host?: string;           // local IP, found automatically
  channel: number;         // which door on the opener (MSG100 = 0)
  model?: string;
}

export interface HubspaceIntegration {
  kind: 'hubspace';
  deviceId: string;        // Hubspace/Afero metadevice id
  powerInstance?: string | null;
  model?: string;
}

export interface HardwareInfo {
  kind: 'esp32' | 'shelly' | 'tasmota' | 'kasa' | 'hubspace' | 'meross';
  online: boolean;
  lastSeen?: number;
  /** Extra live readings the board reports, e.g. its own temperature or signal strength. */
  telemetry?: Record<string, number>;
}

export interface Light extends BaseDevice {
  type: 'light'; on: boolean; brightness: number; color: string;
  /** false for plain on/off wall switches (no brightness or colour) */
  dimmable?: boolean;
}
export interface Blinds extends BaseDevice { type: 'blinds'; position: number } // 0 = closed, 100 = open
export interface Thermostat extends BaseDevice {
  type: 'thermostat'; target: number; current: number; mode: 'heat' | 'cool' | 'auto' | 'off';
}
export interface Lock extends BaseDevice { type: 'lock'; locked: boolean; battery: number }
export interface Fan extends BaseDevice { type: 'fan'; on: boolean; speed: number } // speed 1-3
export interface Plug extends BaseDevice { type: 'plug'; on: boolean }
export interface Tv extends BaseDevice { type: 'tv'; on: boolean; volume: number }

export interface Garage extends BaseDevice {
  type: 'garage';
  open: boolean;
  /** Set for ~20s after a command while the door travels, cleared when the sensor confirms. */
  moving?: 'opening' | 'closing';
}

/** Motion, door/window and safety sensors. Safety sensors (smoke, CO, leak) always alert, armed or not. */
export interface Sensor extends BaseDevice {
  type: 'sensor';
  kind: 'motion' | 'contact' | 'smoke' | 'co' | 'leak';
  triggered: boolean;     // motion seen / door open / smoke, CO or water detected
  battery: number;
  lastTriggered?: number;
}

export type Device = Light | Blinds | Thermostat | Lock | Fan | Plug | Tv | Garage | Sensor;

export type SecurityMode = 'disarmed' | 'home' | 'away';
export interface SecurityState {
  mode: SecurityMode;
  /** Set while an alarm is going off: an intruder (armed + sensor) or a safety hazard. */
  alarm?: { kind: 'intruder' | 'smoke' | 'co' | 'leak'; sensorId: string; room: string; since: number };
  changedAt: number;
  changedBy?: string;
  presenceSim: boolean;   // away mode: lights on/off randomly in the evening so it looks like someone's home
}

export interface Room { id: string; name: string; icon: string }

export interface Scene { id: string; name: string; icon: string; description: string }

export type ActivitySource = 'app' | 'voice' | 'scene' | 'system' | 'hardware';
export interface ActivityEntry { id: string; time: number; source: ActivitySource; text: string; by?: string }

// ---- People & permissions ----
export type Role = 'owner' | 'family' | 'guest';

export interface PublicUser {
  id: string;
  name: string;
  role: Role;
  avatar: string;
  /** Guests only: the rooms they may control, and when their pass stops working. */
  rooms?: string[];
  expiresAt?: number;
}

export interface HomeState {
  rooms: Room[];
  devices: Device[];
  scenes: Scene[];
  activity: ActivityEntry[];
  energy: { time: number; watts: number }[]; // rolling history for the power chart
  outsideTemp: number;
  weather?: WeatherInfo;
  timers: TimerItem[];
  routines: Routine[];
  security: SecurityState;
  /** Hourly energy use for the last week, priced with Ontario time-of-use rates. */
  usage: { hour: number; wh: number; cost: number }[];
  tou: { period: 'off' | 'mid' | 'on'; cents: number; rates: Record<'off' | 'mid' | 'on', number>; today: ('off' | 'mid' | 'on')[]; tip: string };
}

export interface WeatherInfo {
  place: string; temp: number; feelsLike: number; condition: string; icon: string;
  high: number; low: number; rainChance: number; wind: number; sunrise: number; sunset: number;
  hourly: { time: number; temp: number; icon: string }[]; updated: number;
}

/** Timers, alarms and reminders set by voice. */
export interface TimerItem {
  id: string;
  kind: 'timer' | 'alarm' | 'reminder';
  label: string;
  at: number;            // when it fires (ms)
  duration?: number;     // timers: original length (ms), for the progress ring
  createdBy?: string;
  scene?: string;        // alarms: scene to run when it goes off (e.g. Good Morning)
}

/** A custom phrase that runs a list of actions: "when I say 'I'm home', turn on the porch light". */
export interface Routine {
  id: string;
  phrase: string;        // normalized trigger phrase
  actions: string;       // what Nova should do, in plain words
  createdBy?: string;
}

/** A single change to one device. The UI and the voice assistant both produce these. */
export type DevicePatch = { id: string; changes: Record<string, unknown> };
