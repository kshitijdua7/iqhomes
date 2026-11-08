import type { Device, HomeState } from './types.js';

/**
 * Automations: IF <trigger> AND <conditions> THEN <Nova command>.
 * Schedules are automations with a time or sunrise/sunset trigger.
 *
 *   "Porch light on at sunset"                 → sun(sunset)                      → "turn on the porch light"
 *   "IF sunset AND nobody home THEN close blinds" → sun(sunset) + nobodyHome       → "close all the blinds"
 *   "IF front door opens AND it's dark"        → sensor(front-door-contact) + dark → "turn on the porch light"
 */

export type Trigger =
  | { type: 'time'; at: string; days?: number[] }                         // "23:00", days 0-6 (empty = every day)
  | { type: 'sun'; event: 'sunrise' | 'sunset'; offset?: number }         // offset in minutes
  | { type: 'sensor'; deviceId: string; triggered: boolean }
  | { type: 'device'; deviceId: string; field: 'on' | 'locked' | 'open'; value: boolean }
  | { type: 'security'; mode: 'disarmed' | 'home' | 'away' };

export type Condition =
  | { type: 'dark' }
  | { type: 'nobodyHome' }
  | { type: 'between'; after: string; before: string }
  | { type: 'device'; deviceId: string; field: 'on' | 'locked' | 'open'; value: boolean }
  | { type: 'security'; mode: 'disarmed' | 'home' | 'away' };

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  conditions: Condition[];
  then: string;          // a Nova command, e.g. "turn on the porch light and set the heat to 22"
  createdBy?: string;
  lastRun?: number;
}

const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

function sunTimes(home: HomeState) {
  const w = home.weather;
  if (w) return { sunrise: new Date(w.sunrise), sunset: new Date(w.sunset) };
  const d = new Date(); // fallback without weather: 7 am / 5 pm
  return { sunrise: new Date(d.setHours(7, 0, 0, 0)), sunset: new Date(new Date().setHours(17, 0, 0, 0)) };
}

export function isDark(home: HomeState, now = new Date()) {
  const { sunrise, sunset } = sunTimes(home);
  const m = now.getHours() * 60 + now.getMinutes();
  return m < sunrise.getHours() * 60 + sunrise.getMinutes() || m >= sunset.getHours() * 60 + sunset.getMinutes();
}

function fieldOf(d: Device | undefined, field: string) {
  return d ? (d as unknown as Record<string, unknown>)[field] : undefined;
}

export function conditionsMet(a: Automation, home: HomeState, now = new Date()): boolean {
  return a.conditions.every((c) => {
    switch (c.type) {
      case 'dark': return isDark(home, now);
      case 'nobodyHome': return home.security.mode === 'away';
      case 'security': return home.security.mode === c.mode;
      case 'between': {
        const m = now.getHours() * 60 + now.getMinutes(), a1 = toMin(c.after), b = toMin(c.before);
        return a1 <= b ? m >= a1 && m < b : m >= a1 || m < b; // supports overnight ranges
      }
      case 'device': return fieldOf(home.devices.find((d) => d.id === c.deviceId), c.field) === c.value;
    }
  });
}

/** Time and sunrise/sunset triggers that fire this minute. */
export function dueByClock(list: Automation[], home: HomeState, now = new Date()): Automation[] {
  const minuteKey = Math.floor(now.getTime() / 60_000);
  const { sunrise, sunset } = sunTimes(home);
  return list.filter((a) => {
    if (!a.enabled || (a.lastRun && Math.floor(a.lastRun / 60_000) === minuteKey)) return false;
    const t = a.trigger;
    if (t.type === 'time') return t.at === hm(now) && (!t.days?.length || t.days.includes(now.getDay()));
    if (t.type === 'sun') {
      const base = t.event === 'sunrise' ? sunrise : sunset;
      return hm(new Date(base.getTime() + (t.offset ?? 0) * 60_000)) === hm(now);
    }
    return false;
  }).filter((a) => conditionsMet(a, home, now));
}

/** Device and sensor triggers that fire because of these changes. */
export function dueByChange(list: Automation[], changed: Device[], home: HomeState): Automation[] {
  return list.filter((a) => {
    if (!a.enabled) return false;
    const t = a.trigger;
    if (t.type === 'sensor') { const d = changed.find((x) => x.id === t.deviceId); return !!d && d.type === 'sensor' && d.triggered === t.triggered; }
    if (t.type === 'device') { const d = changed.find((x) => x.id === t.deviceId); return !!d && fieldOf(d, t.field) === t.value; }
    return false;
  }).filter((a) => conditionsMet(a, home));
}

export function dueBySecurity(list: Automation[], mode: string, home: HomeState): Automation[] {
  return list.filter((a) => a.enabled && a.trigger.type === 'security' && a.trigger.mode === mode).filter((a) => conditionsMet(a, home));
}

/** Plain-English description, used in the app and by Nova. */
export function describe(a: Automation, home: HomeState): string {
  const name = (id: string) => home.devices.find((d) => d.id === id)?.name ?? id;
  const t = a.trigger;
  const when = t.type === 'time' ? `at ${t.at}${t.days?.length && t.days.length < 7 ? ` on ${t.days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}` : ' every day'}`
    : t.type === 'sun' ? `${t.offset ? `${Math.abs(t.offset)} min ${t.offset < 0 ? 'before' : 'after'} ` : 'at '}${t.event}`
    : t.type === 'sensor' ? `when ${name(t.deviceId)} ${t.triggered ? 'is triggered' : 'clears'}`
    : t.type === 'device' ? `when ${name(t.deviceId)} turns ${t.field === 'locked' ? (t.value ? 'locked' : 'unlocked') : t.field === 'open' ? (t.value ? 'open' : 'closed') : t.value ? 'on' : 'off'}`
    : `when security is set to ${t.mode}`;
  const ifs = a.conditions.map((c) => c.type === 'dark' ? "it's dark" : c.type === 'nobodyHome' ? 'nobody is home'
    : c.type === 'between' ? `it's between ${c.after} and ${c.before}` : c.type === 'security' ? `security is ${c.mode}`
    : `${name(c.deviceId)} is ${c.field === 'locked' ? (c.value ? 'locked' : 'unlocked') : c.field === 'open' ? (c.value ? 'open' : 'closed') : c.value ? 'on' : 'off'}`);
  return `${when[0].toUpperCase()}${when.slice(1)}${ifs.length ? `, if ${ifs.join(' and ')}` : ''}: ${a.then}`;
}

export function validAutomation(x: unknown): x is Omit<Automation, 'id'> {
  if (!x || typeof x !== 'object') return false;
  const a = x as Record<string, unknown>;
  const t = a.trigger as Record<string, unknown> | undefined;
  return typeof a.then === 'string' && a.then.trim().length > 0 && a.then.length < 300 && !!t &&
    ['time', 'sun', 'sensor', 'device', 'security'].includes(String(t.type)) &&
    (t.type !== 'time' || /^\d{2}:\d{2}$/.test(String(t.at))) && Array.isArray(a.conditions) && a.conditions.length <= 6;
}

/** Ready-made automations offered in the builder. */
export const TEMPLATES: Omit<Automation, 'id' | 'enabled'>[] = [
  { name: 'Porch light at sunset', trigger: { type: 'sun', event: 'sunset' }, conditions: [], then: 'turn on the porch light' },
  { name: 'Porch light off at 11 pm', trigger: { type: 'time', at: '23:00' }, conditions: [], then: 'turn off the porch light' },
  { name: 'Close blinds at sunset when away', trigger: { type: 'sun', event: 'sunset' }, conditions: [{ type: 'nobodyHome' }], then: 'close all the blinds' },
  { name: 'Welcome light', trigger: { type: 'sensor', deviceId: 'front-door-contact', triggered: true }, conditions: [{ type: 'dark' }], then: 'turn on the porch light and the hallway lights' },
  { name: 'Weekday wake-up warmth', trigger: { type: 'time', at: '06:30', days: [1, 2, 3, 4, 5] }, conditions: [], then: 'set the temperature to 21' },
  { name: 'Lock up when away', trigger: { type: 'security', mode: 'away' }, conditions: [], then: 'lock the front door and close the garage' },
];
