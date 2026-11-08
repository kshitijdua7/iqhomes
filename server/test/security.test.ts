import { describe, expect, it, vi } from 'vitest';
import { Home } from '../src/home';
import { Security } from '../src/security';
import { matchSkill } from '../src/skills';
import type { Sensor } from '../src/types';

function setup() {
  const home = new Home();
  const alerts: string[] = [];
  const sec = new Security(home, {
    alert: (title) => alerts.push(title),
    apply: (patches) => { home.apply(patches, 'system'); },
  });
  const trigger = (id: string) => {
    const d = home.device(id) as Sensor;
    d.triggered = true;
    sec.onSensor(d);
  };
  return { home, sec, alerts, trigger };
}

describe('security system', () => {
  it('ignores motion when disarmed, alarms when armed away', () => {
    vi.useFakeTimers();
    const { sec, alerts, trigger, home } = setup();
    trigger('living-motion');
    expect(alerts).toEqual([]);
    sec.setMode('away', 'K');
    trigger('entrance-motion');
    expect(alerts[0]).toMatch(/Intruder/);
    expect(home.state.security.alarm?.kind).toBe('intruder');
    sec.silence('K');
    expect(home.state.security.alarm).toBeUndefined();
    expect(home.state.security.mode).toBe('disarmed');
    vi.useRealTimers();
  });

  it('home mode only watches doors and windows', () => {
    vi.useFakeTimers();
    const { sec, alerts, trigger } = setup();
    sec.setMode('home');
    trigger('living-motion');
    expect(alerts).toEqual([]);
    trigger('living-window');
    expect(alerts[0]).toMatch(/Intruder/);
    vi.useRealTimers();
  });

  it('smoke always alarms and turns every light on', () => {
    const { home, alerts, trigger } = setup();
    trigger('kitchen-smoke');
    expect(alerts[0]).toMatch(/Smoke detected in the kitchen/);
    expect(home.state.devices.filter((d) => d.type === 'light').every((d) => d.type === 'light' && d.on)).toBe(true);
    expect(home.state.devices.find((d) => d.type === 'thermostat')).toMatchObject({ mode: 'off' });
  });

  it('Away scene arms the system', () => {
    const { home, sec } = setup();
    home.sceneHook = (id) => { if (id === 'away') sec.setMode('away'); };
    home.runScene('away');
    expect(home.state.security.mode).toBe('away');
  });

  it('understands security voice commands', () => {
    const h = new Home().state;
    expect(matchSkill('arm the security system', h)).toEqual({ kind: 'security', mode: 'away' });
    expect(matchSkill('arm home', h)).toEqual({ kind: 'security', mode: 'home' });
    expect(matchSkill('disarm the alarm system', h)).toEqual({ kind: 'security', mode: 'disarmed' });
    h.security.alarm = { kind: 'intruder', sensorId: 'x', room: 'living', since: 0 };
    expect(matchSkill('turn off the alarm', h)).toEqual({ kind: 'silence' });
  });
});
