// Shared data shapes for the whole smart home.
// The web app keeps a copy of these in web/src/types.ts.

export type DeviceType = 'light' | 'blinds' | 'thermostat' | 'lock' | 'fan' | 'plug' | 'tv';

export interface BaseDevice {
  id: string;
  name: string;
  room: string;
  type: DeviceType;
  watts: number; // current power draw, recalculated by the simulator
}

export interface Light extends BaseDevice { type: 'light'; on: boolean; brightness: number; color: string }
export interface Blinds extends BaseDevice { type: 'blinds'; position: number } // 0 = closed, 100 = open
export interface Thermostat extends BaseDevice {
  type: 'thermostat'; target: number; current: number; mode: 'heat' | 'cool' | 'auto' | 'off';
}
export interface Lock extends BaseDevice { type: 'lock'; locked: boolean; battery: number }
export interface Fan extends BaseDevice { type: 'fan'; on: boolean; speed: number } // speed 1-3
export interface Plug extends BaseDevice { type: 'plug'; on: boolean }
export interface Tv extends BaseDevice { type: 'tv'; on: boolean; volume: number }

export type Device = Light | Blinds | Thermostat | Lock | Fan | Plug | Tv;

export interface Room { id: string; name: string; icon: string }

export interface Scene { id: string; name: string; icon: string; description: string }

export interface ActivityEntry { id: string; time: number; source: 'app' | 'voice' | 'scene' | 'system'; text: string }

export interface HomeState {
  rooms: Room[];
  devices: Device[];
  scenes: Scene[];
  activity: ActivityEntry[];
  energy: { time: number; watts: number }[]; // rolling history for the power chart
  outsideTemp: number;
}

/** A single change to one device. The UI and the voice assistant both produce these. */
export type DevicePatch = { id: string; changes: Record<string, unknown> };
