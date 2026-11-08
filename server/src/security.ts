import type { Home } from './home.js';
import type { Device, DevicePatch, SecurityMode, Sensor } from './types.js';

/**
 * Security system + safety sensors.
 *
 *  disarmed – only safety sensors (smoke, CO, leak) alert
 *  home     – door/window sensors trigger the alarm (motion is ignored, people are moving around inside)
 *  away     – any motion or door/window sensor triggers the alarm
 *
 * Safety hazards always alert, whatever the mode, and the house reacts:
 *   smoke / CO → every light on at full brightness, blinds open, heating/cooling off (stops spreading smoke)
 *   leak       → loud announcement + alert
 */

export interface SecurityEvents {
  /** Something to say out loud on every screen + push to phones. */
  alert(title: string, body: string, urgency: 'alarm' | 'warn' | 'info', roles?: ('owner' | 'family' | 'guest')[]): void;
  /** Apply device changes made by the security system. */
  apply(patches: DevicePatch[], note: string): void;
}

const SAFETY = new Set(['smoke', 'co', 'leak']);
const MOTION_RESET_MS = 30_000;

export class Security {
  private motionTimers = new Map<string, NodeJS.Timeout>();

  constructor(private home: Home, private events: SecurityEvents) {}

  get state() { return this.home.state.security; }

  setMode(mode: SecurityMode, by?: string): string {
    const s = this.state;
    if (s.mode === mode && !s.alarm) return mode === 'disarmed' ? 'The security system is already off.' : `Already armed (${mode}).`;
    const wasAlarm = !!s.alarm && s.alarm.kind === 'intruder';
    s.mode = mode;
    s.changedAt = Date.now();
    s.changedBy = by;
    if (mode === 'disarmed' && s.alarm?.kind === 'intruder') s.alarm = undefined;
    const open = this.home.state.devices.filter((d): d is Sensor => d.type === 'sensor' && d.kind === 'contact' && d.triggered);
    this.home.log('system', mode === 'disarmed' ? `🛡️ Security disarmed${wasAlarm ? ' (alarm silenced)' : ''}` : `🛡️ Security armed: ${mode === 'away' ? 'Away' : 'Home'}`, by);
    if (mode === 'disarmed') return wasAlarm ? 'Alarm silenced and security disarmed.' : 'Security system disarmed.';
    const warn = open.length ? ` Heads up: ${open.map((d) => d.name).join(', ')} ${open.length > 1 ? 'are' : 'is'} open.` : '';
    return `Security armed in ${mode === 'away' ? 'Away' : 'Home'} mode.${warn}`;
  }

  /** Silence an alarm (safety alarms can be silenced; the sensor still has to clear). */
  silence(by?: string): string {
    const a = this.state.alarm;
    if (!a) return 'There is no alarm going off.';
    this.state.alarm = undefined;
    if (a.kind === 'intruder') this.state.mode = 'disarmed';
    this.home.log('system', `🔕 Alarm silenced`, by);
    return a.kind === 'intruder' ? 'Alarm silenced and security disarmed.' : 'Alarm silenced. Please make sure everyone is safe.';
  }

  /** Called whenever a sensor changes (from the app, a simulation, or real hardware). */
  onSensor(d: Sensor) {
    if (!d.triggered) {
      if (this.state.alarm?.sensorId === d.id && SAFETY.has(d.kind)) {
        this.state.alarm = undefined;
        this.events.alert('✅ All clear', `${d.name} is back to normal.`, 'info');
      }
      return;
    }
    d.lastTriggered = Date.now();
    const room = this.home.state.rooms.find((r) => r.id === d.room)?.name ?? d.room;

    // Motion sensors reset themselves after a short while, like real ones.
    if (d.kind === 'motion') {
      clearTimeout(this.motionTimers.get(d.id));
      this.motionTimers.set(d.id, setTimeout(() => {
        if (d.triggered) this.events.apply([{ id: d.id, changes: { triggered: false } }], `${d.name}: clear`);
      }, MOTION_RESET_MS));
    }

    if (SAFETY.has(d.kind)) {
      const kind = d.kind as 'smoke' | 'co' | 'leak';
      this.state.alarm = { kind, sensorId: d.id, room: d.room, since: Date.now() };
      if (kind === 'leak') {
        this.events.alert(`💧 Water leak in the ${room.toLowerCase()}`, `${d.name} detected water. Check it right away.`, 'alarm', ['owner', 'family', 'guest']);
      } else {
        const what = kind === 'smoke' ? 'Smoke' : 'Carbon monoxide';
        this.events.alert(`🚨 ${what} detected in the ${room.toLowerCase()}`, `${what} detected by ${d.name}. Get everyone outside${kind === 'co' ? ' into fresh air' : ''} and call 911.`, 'alarm', ['owner', 'family', 'guest']);
        const ds = this.home.state.devices;
        this.events.apply([
          ...ds.filter((x) => x.type === 'light').map((x) => ({ id: x.id, changes: { on: true, brightness: 100, color: '#ffffff' } })),
          ...ds.filter((x) => x.type === 'blinds').map((x) => ({ id: x.id, changes: { position: 100 } })),
          ...ds.filter((x) => x.type === 'thermostat').map((x) => ({ id: x.id, changes: { mode: 'off' } })),
        ], `🚨 ${what} response: lights on, blinds open, heating off`);
      }
      return;
    }

    const mode = this.state.mode;
    const intrusion = (mode === 'away' && (d.kind === 'motion' || d.kind === 'contact')) || (mode === 'home' && d.kind === 'contact');
    if (intrusion && !this.state.alarm) {
      this.state.alarm = { kind: 'intruder', sensorId: d.id, room: d.room, since: Date.now() };
      this.events.alert('🚨 Intruder alert', `${d.name} ${d.kind === 'motion' ? 'saw motion' : 'was opened'} in the ${room.toLowerCase()} while the system was armed.`, 'alarm', ['owner', 'family']);
      const ds = this.home.state.devices;
      this.events.apply(ds.filter((x) => x.type === 'light').map((x) => ({ id: x.id, changes: { on: true, brightness: 100, color: '#ff4d4d' } })), '🚨 Intruder response: every light on');
    }
  }

  /** Away mode, evenings: switch a random light on or off now and then so the house looks lived in. */
  presenceTick(sunset?: number) {
    const s = this.state;
    if (s.mode !== 'away' || !s.presenceSim || s.alarm) return;
    const now = new Date();
    const afterDark = sunset ? Date.now() > sunset : now.getHours() >= 18;
    if (!afterDark || now.getHours() >= 23) return;
    if (Math.random() > 0.35) return; // roughly every few minutes
    const lights = this.home.state.devices.filter((d): d is Device & { type: 'light'; on: boolean } => d.type === 'light' && !d.integration);
    const pick = lights[Math.floor(Math.random() * lights.length)];
    if (!pick) return;
    this.events.apply([{ id: pick.id, changes: { on: !pick.on, brightness: 70 } }], `🎭 Presence simulation: ${pick.name} ${pick.on ? 'off' : 'on'}`);
  }
}
