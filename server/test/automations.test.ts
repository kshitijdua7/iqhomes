import { describe, expect, it } from 'vitest';
import { conditionsMet, dueByChange, dueByClock, type Automation } from '../src/automations';
import { Home } from '../src/home';

const base = (over: Partial<Automation>): Automation => ({ id: 'a', name: 'x', enabled: true, trigger: { type: 'time', at: '23:00' }, conditions: [], then: 'turn off the porch light', ...over });

describe('automation engine', () => {
  it('fires time triggers on the right minute and days only', () => {
    const h = new Home().state;
    const a = base({ trigger: { type: 'time', at: '23:00', days: [1] } });
    expect(dueByClock([a], h, new Date('2026-11-09T23:00:10'))).toHaveLength(1); // Monday
    expect(dueByClock([a], h, new Date('2026-11-10T23:00:10'))).toHaveLength(0); // Tuesday
    expect(dueByClock([a], h, new Date('2026-11-09T22:59:10'))).toHaveLength(0);
  });
  it('checks "nobody home" and "dark" conditions', () => {
    const h = new Home().state;
    const a = base({ conditions: [{ type: 'nobodyHome' }] });
    expect(conditionsMet(a, h)).toBe(false);
    h.security.mode = 'away';
    expect(conditionsMet(a, h)).toBe(true);
    h.weather = { sunrise: new Date('2026-11-09T07:00').getTime(), sunset: new Date('2026-11-09T17:00').getTime() } as never;
    expect(conditionsMet(base({ conditions: [{ type: 'dark' }] }), h, new Date('2026-11-09T21:00'))).toBe(true);
    expect(conditionsMet(base({ conditions: [{ type: 'dark' }] }), h, new Date('2026-11-09T12:00'))).toBe(false);
  });
  it('fires sensor triggers when the sensor changes', () => {
    const home = new Home();
    const a = base({ trigger: { type: 'sensor', deviceId: 'front-door-contact', triggered: true } });
    const changed = home.apply([{ id: 'front-door-contact', changes: { triggered: true } }]);
    expect(dueByChange([a], changed, home.state)).toHaveLength(1);
    expect(dueByChange([{ ...a, enabled: false }], changed, home.state)).toHaveLength(0);
  });
});
