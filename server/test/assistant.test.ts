import { describe, expect, it } from 'vitest';
import { Home } from '../src/home';
import { interpret } from '../src/assistant';

const fresh = () => new Home().state;
const changesFor = (r: ReturnType<typeof interpret>, id: string) =>
  Object.assign({}, ...r.patches.filter((p) => p.id === id).map((p) => p.changes));

describe('Nova assistant', () => {
  it('dims a room and carries the room into the next clause', () => {
    const r = interpret('Hey Nova, dim the living room to 30% and close the blinds', fresh());
    expect(changesFor(r, 'living-main')).toMatchObject({ on: true, brightness: 30 });
    expect(changesFor(r, 'living-lamp')).toMatchObject({ brightness: 30 });
    expect(changesFor(r, 'living-blinds')).toEqual({ position: 0 });
    expect(changesFor(r, 'bedroom-blinds')).toEqual({}); // other rooms untouched
  });

  it('understands number words from speech', () => {
    const r = interpret('set the temperature to twenty two degrees', fresh());
    expect(changesFor(r, 'thermostat')).toEqual({ target: 22 });
    expect(r.reply).toContain('22');
  });

  it('turns off every light in the house', () => {
    const r = interpret('turn off all the lights', fresh());
    const lightIds = fresh().devices.filter((d) => d.type === 'light').map((d) => d.id);
    expect(r.patches.map((p) => p.id).sort()).toEqual(lightIds.sort());
    expect(r.patches.every((p) => p.changes.on === false)).toBe(true);
  });

  it('handles feelings like "I\'m cold"', () => {
    const r = interpret("I'm cold", fresh());
    expect(changesFor(r, 'thermostat').target).toBe(23); // starts at 21
  });

  it('locks and unlocks the front door', () => {
    expect(changesFor(interpret('lock the front door', fresh()), 'front-door')).toEqual({ locked: true });
    expect(changesFor(interpret('unlock the door', fresh()), 'front-door')).toEqual({ locked: false });
  });

  it('changes light colour', () => {
    const r = interpret('make the bedroom lights purple', fresh());
    expect(changesFor(r, 'bedroom-main')).toMatchObject({ on: true, color: '#9b6bff' });
  });

  it('recognises scenes', () => {
    expect(interpret("it's movie night", fresh()).scenes).toEqual(['movie']);
    expect(interpret("good night nova", fresh()).scenes).toEqual(['night']);
    expect(interpret("I'm leaving now", fresh()).scenes).toEqual(['away']);
  });

  it('starts the coffee maker', () => {
    expect(changesFor(interpret('turn on the coffee maker', fresh()), 'kitchen-coffee')).toEqual({ on: true });
  });

  it('answers questions without changing anything', () => {
    const r = interpret('is the front door locked?', fresh());
    expect(r.patches).toHaveLength(0);
    expect(r.reply).toMatch(/locked/);
    expect(interpret('how much power are we using', fresh()).reply).toMatch(/watts/);
  });

  it('admits when it does not understand', () => {
    const r = interpret('order me a pizza', fresh());
    expect(r.understood).toBe(false);
    expect(r.patches).toHaveLength(0);
  });

  it('opens the blinds part way', () => {
    expect(changesFor(interpret('open the bedroom blinds to 40 percent', fresh()), 'bedroom-blinds')).toEqual({ position: 40 });
  });
});

describe('Home simulator', () => {
  it('clamps bad values and ignores unknown fields', () => {
    const home = new Home();
    home.apply([{ id: 'living-main', changes: { brightness: 500, hacked: true } }]);
    const light = home.device('living-main') as { brightness: number };
    expect(light.brightness).toBe(100);
    expect('hacked' in light).toBe(false);
  });

  it('moves indoor temperature toward the target', () => {
    const home = new Home();
    home.apply([{ id: 'thermostat', changes: { target: 25 } }]);
    const before = (home.device('thermostat') as { current: number }).current;
    home.tick(); home.tick();
    expect((home.device('thermostat') as { current: number }).current).toBeGreaterThan(before);
  });

  it('a scene changes many devices at once', () => {
    const home = new Home();
    const changed = home.runScene('night');
    expect(changed.length).toBeGreaterThan(3);
    expect(home.state.devices.filter((d) => d.type === 'light').every((d) => d.type === 'light' && !d.on)).toBe(true);
  });
});
