import { describe, expect, it } from 'vitest';
import { authHashes, xorDecrypt, xorEncrypt } from '../src/kasa';
import { interpret } from '../src/assistant';
import { Home } from '../src/home';
import type { Light } from '../src/types';

describe('kasa protocol helpers', () => {
  it('legacy XOR round-trips', () => {
    // first byte is '{' ^ 171; full value cross-checked against an independent Python implementation
    expect(xorEncrypt('{"system":{"get_sysinfo":{}}}').toString('hex')).toBe('d0f281f88bff9af7d5ef94b6d1b4c09fec95e68fe187e8caf08bf68bf6');
    const msg = JSON.stringify({ system: { get_sysinfo: {} } });
    expect(xorDecrypt(xorEncrypt(msg))).toBe(msg);
  });

  it('hashes credentials (never keeps the password)', () => {
    const h = authHashes({ username: 'a@b.c', password: 'secret' });
    expect(h.v2).toHaveLength(64);
    expect(h.v1).toHaveLength(32);
    expect(JSON.stringify(h)).not.toContain('secret');
  });
});

describe('Nova and added switches', () => {
  const withSwitch = () => {
    const home = new Home();
    home.addDevice({
      id: 'kasa-1', name: 'Room Light', room: 'bedroom', type: 'light', on: false, brightness: 100, color: '#ffd9a0',
      dimmable: false, watts: 0, integration: { kind: 'kasa', host: '192.168.0.9', protocol: 'klap-smart' },
    } satisfies Light);
    return home.state;
  };

  it('controls a switch by the name the owner gave it', () => {
    const r = interpret('Hey Nova, turn on my room light', withSwitch());
    expect(r.patches).toEqual([{ id: 'kasa-1', changes: { on: true } }]);
  });

  it('still includes it in room-wide commands', () => {
    const r = interpret('turn off the bedroom lights', withSwitch());
    expect(r.patches.map((p) => p.id)).toContain('kasa-1');
  });
});

describe('Nova and the garage', () => {
  const withGarage = (open = false) => {
    const home = new Home();
    home.addDevice({ id: 'garage-1', name: 'Garage Door', room: 'entrance', type: 'garage', open, watts: 0,
      integration: { kind: 'meross', uuid: 'u1', channel: 0 } });
    return home.state;
  };

  it('opens and closes the garage', () => {
    expect(interpret('hey nova open the garage', withGarage()).patches).toEqual([{ id: 'garage-1', changes: { open: true } }]);
    expect(interpret('close the garage door', withGarage(true)).patches).toEqual([{ id: 'garage-1', changes: { open: false } }]);
  });

  it('never confuses the garage door with the front door', () => {
    const r = interpret('close the garage door', withGarage(true));
    expect(r.patches.map((p) => p.id)).not.toContain('front-door');
    expect(interpret('lock the front door', withGarage()).patches).toEqual([{ id: 'front-door', changes: { locked: true } }]);
  });

  it('answers "is the garage open?" without moving it', () => {
    const r = interpret('is the garage open?', withGarage(true));
    expect(r.patches).toEqual([]);
    expect(r.reply).toMatch(/garage door is open/);
  });

  it('good night closes the garage', () => {
    const home = new Home();
    home.addDevice({ id: 'garage-1', name: 'Garage Door', room: 'entrance', type: 'garage', open: true, watts: 0,
      integration: { kind: 'meross', uuid: 'u1', channel: 0 } });
    home.runScene('night');
    expect((home.device('garage-1') as { open: boolean }).open).toBe(false);
  });
});
