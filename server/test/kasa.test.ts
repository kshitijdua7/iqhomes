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
