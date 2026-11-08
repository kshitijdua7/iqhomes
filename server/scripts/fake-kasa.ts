/**
 * A pretend Kasa KS205 wall switch that speaks the real local protocol (UDP discovery + KLAP v2 encryption).
 * Use it to try "Add Kasa switch" with no hardware, or to test the connector.
 *
 *   npm run fake-kasa --prefix server
 *
 * Press ENTER to flip the switch "by hand". Its login is the same as yours in the app:
 *   KASA_EMAIL=you@example.com KASA_PASSWORD=secret npm run fake-kasa --prefix server
 * (defaults: demo@iqhomes.dev / demo1234)
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createSocket } from 'node:dgram';
import { createInterface } from 'node:readline';
import { authHashes } from '../src/kasa.js';

const EMAIL = process.env.KASA_EMAIL ?? 'demo@iqhomes.dev';
const PASSWORD = process.env.KASA_PASSWORD ?? 'demo1234';
const PORT = Number(process.env.KASA_PORT ?? 8080);
const MAC = '50-91-E3-AA-20-5B';
const auth = Buffer.from(authHashes({ username: EMAIL, password: PASSWORD }).v2, 'hex');
const sha256 = (...p: Buffer[]) => createHash('sha256').update(Buffer.concat(p)).digest();

let on = false;
const nickname = Buffer.from('Bedroom Switch').toString('base64');
const sessions = new Map<string, { local: Buffer; remote: Buffer; key?: Buffer; iv?: Buffer; sig?: Buffer }>();

const show = () => console.log(`💡 Switch is ${on ? 'ON  ████' : 'OFF ░░░░'}`);

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const url = new URL(req.url ?? '/', 'http://x');
    const cookie = /TP_SESSIONID=([^;]+)/.exec(req.headers.cookie ?? '')?.[1] ?? '';

    if (url.pathname === '/app/handshake1') {
      const remote = randomBytes(16), id = randomBytes(16).toString('hex').toUpperCase();
      sessions.set(id, { local: body, remote });
      res.setHeader('Set-Cookie', `TP_SESSIONID=${id};TIMEOUT=86400`);
      return res.end(Buffer.concat([remote, sha256(body, remote, auth)]));
    }
    const s = sessions.get(cookie);
    if (!s) { res.statusCode = 403; return res.end(); }

    if (url.pathname === '/app/handshake2') {
      if (!sha256(s.remote, s.local, auth).equals(body)) { res.statusCode = 403; return res.end(); }
      const local = Buffer.concat([s.local, s.remote, auth]);
      const ivFull = sha256(Buffer.from('iv'), local);
      Object.assign(s, { key: sha256(Buffer.from('lsk'), local).subarray(0, 16), iv: ivFull.subarray(0, 12), sig: sha256(Buffer.from('ldk'), local).subarray(0, 28) });
      return res.end();
    }

    if (url.pathname === '/app/request' && s.key) {
      const seq = Buffer.alloc(4); seq.writeInt32BE(Number(url.searchParams.get('seq')));
      const iv = Buffer.concat([s.iv!, seq]);
      const cipher = body.subarray(32);
      if (!sha256(s.sig!, seq, cipher).equals(body.subarray(0, 32))) { res.statusCode = 400; return res.end(); }
      const d = createDecipheriv('aes-128-cbc', s.key, iv);
      const msg = JSON.parse(Buffer.concat([d.update(cipher), d.final()]).toString());
      let reply: unknown = { error_code: -1 };
      if (msg.method === 'get_device_info') {
        reply = { error_code: 0, result: { device_on: on, nickname, model: 'KS205', mac: MAC, type: 'SMART.KASASWITCH' } };
      } else if (msg.method === 'set_device_info' && typeof msg.params?.device_on === 'boolean') {
        on = msg.params.device_on;
        show();
        reply = { error_code: 0 };
      }
      const c = createCipheriv('aes-128-cbc', s.key, iv);
      const out = Buffer.concat([c.update(Buffer.from(JSON.stringify(reply))), c.final()]);
      return res.end(Buffer.concat([sha256(s.sig!, seq, out), out]));
    }
    res.statusCode = 404;
    res.end();
  });
}).listen(PORT, () => {
  console.log(`🔌 Fake Kasa KS205 listening on port ${PORT} (login ${EMAIL} / ${PASSWORD}). Press ENTER to flip it by hand.`);
  show();
});

// Answer discovery broadcasts on the standard Kasa port.
const udp = createSocket({ type: 'udp4', reuseAddr: true });
udp.on('message', (_msg, rinfo) => {
  const json = JSON.stringify({
    error_code: 0,
    result: {
      device_id: 'fake-ks205', device_type: 'SMART.KASASWITCH', device_model: 'KS205(US)', ip: '127.0.0.1', mac: MAC,
      mgt_encrypt_schm: { is_support_https: false, encrypt_type: 'KLAP', http_port: PORT, lv: 2 },
    },
  });
  udp.send(Buffer.concat([Buffer.alloc(16), Buffer.from(json)]), rinfo.port, rinfo.address);
});
udp.bind(20002);

createInterface({ input: process.stdin }).on('line', () => { on = !on; console.log('👆 flipped by hand'); show(); });
