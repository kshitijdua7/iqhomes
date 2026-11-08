import { describe, expect, it } from 'vitest';
import { matchSkill, parseClock, parseDuration } from '../src/skills';
import { Home } from '../src/home';

const now = new Date('2026-11-08T15:00:00'); // 3 pm
const home = () => new Home().state;

describe('durations and clock times', () => {
  it('parses durations', () => {
    expect(parseDuration('10 minutes')).toBe(600_000);
    expect(parseDuration('1 hour and 30 minutes')).toBe(5_400_000);
    expect(parseDuration('an hour')).toBe(3_600_000);
    expect(parseDuration('45 seconds')).toBe(45_000);
  });
  it('picks the next matching clock time', () => {
    expect(new Date(parseClock('at 8', now)!).getHours()).toBe(20);          // next 8 o'clock is 8 pm
    expect(new Date(parseClock('7', now, true)!).getHours()).toBe(7);        // wake-up assumes morning
    expect(new Date(parseClock('6:30 pm', now)!).getMinutes()).toBe(30);
  });
});

describe('Nova skills', () => {
  it('sets a named timer', () => {
    const s = matchSkill('Set a timer for 10 minutes for pasta', home(), 'K', now);
    expect(s?.kind).toBe('timer');
    if (s?.kind === 'timer') { expect(s.item.duration).toBe(600_000); expect(s.item.label).toBe('pasta'); }
  });
  it('wakes me up at 7 and runs Good Morning', () => {
    const s = matchSkill('Wake me up at 7', home(), 'K', now);
    if (s?.kind !== 'timer') throw new Error('expected alarm');
    expect(s.item.kind).toBe('alarm');
    expect(s.item.scene).toBe('morning');
    expect(new Date(s.item.at).getHours()).toBe(7);
  });
  it('remembers reminders', () => {
    const s = matchSkill('Remind me to take out the garbage at 8', home(), 'K', now);
    if (s?.kind !== 'timer') throw new Error('expected reminder');
    expect(s.item.label).toBe('take out the garbage');
    expect(new Date(s.item.at).getHours()).toBe(20);
    const s2 = matchSkill('remind me in 20 minutes to check the oven', home(), 'K', now);
    if (s2?.kind !== 'timer') throw new Error('expected reminder');
    expect(s2.item.at - now.getTime()).toBe(1_200_000);
  });
  it('makes announcements', () => {
    expect(matchSkill('Announce dinner is ready', home())).toEqual({ kind: 'announce', message: 'dinner is ready' });
  });
  it('understands weather questions', () => {
    expect(matchSkill("What's the weather like?", home())?.kind).toBe('weather');
    expect(matchSkill('do I need an umbrella', home())?.kind).toBe('weather');
  });
  it('defines and triggers voice routines', () => {
    const s = matchSkill("Nova, when I say 'I'm home', turn on the porch light and set the heat to 22", home());
    expect(s).toEqual({ kind: 'defineRoutine', phrase: "im home", actions: 'turn on the porch light and set the heat to 22' });
    const h = home();
    h.routines.push({ id: 'r1', phrase: 'im home', actions: 'turn on the porch light' });
    expect(matchSkill("I'm home!", h)?.kind).toBe('runRoutine');
  });
  it('leaves device commands alone', () => {
    expect(matchSkill('turn on the kitchen lights', home())).toBeUndefined();
    expect(matchSkill('set the temperature to 22', home())).toBeUndefined();
  });
});
