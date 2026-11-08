import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { Socket } from 'node:net';

/**
 * TP-Link Kasa / Tapo local control: talks to switches and plugs directly on your Wi-Fi, no cloud round trip.
 *
 * Three ways a Kasa device can speak, newest first:
 *  - KLAP + "smart" JSON  (e.g. KS205, KS225, newer Tapo)   port 80, encrypted, needs your TP-Link login
 *  - KLAP + legacy JSON   (Kasa devices on newer firmware)   port 80, encrypted, needs your TP-Link login
 *  - legacy XOR           (older Kasa plugs and switches)    port 9999, no login
 *
 * Protocol reference: the open-source python-kasa project (github.com/python-kasa/python-kasa).
 */

export type KasaProtocol = 'klap-smart' | 'klap-iot' | 'legacy';

export interface KasaCredentials { username: string; password: string }

export interface KasaInfo {
  host: string;
  protocol: KasaProtocol;
  alias: string;
  model: string;
  mac?: string;
  on: boolean;
}

const sha256 = (...parts: Buffer[]) => createHash('sha256').update(Buffer.concat(parts)).digest();
const sha1 = (b: Buffer) => createHash('sha1').update(b).digest();
const md5 = (b: Buffer) => createHash('md5').update(b).digest();

/** KLAP v2 / v1 password hashes. We store these, never the password itself. */
export function authHashes({ username, password }: KasaCredentials) {
  const u = Buffer.from(username), p = Buffer.from(password);
  return { v2: sha256(sha1(u), sha1(p)).toString('hex'), v1: md5(Buffer.concat([md5(u), md5(p)])).toString('hex') };
}

/** Credentials Kasa devices accept before they are bound to an account (python-kasa tries the same ones). */
const FALLBACK_HASHES = [
  { username: '', password: '' },
  { username: 'kasa@tp-link.net', password: 'kasaSetup' },
  { username: 'test@tp-link.net', password: 'test' },
].map(authHashes);

// ---------------------------------------------------------------------------------------------
// KLAP transport
// ---------------------------------------------------------------------------------------------

interface KlapSession { cookie: string; key: Buffer; iv: Buffer; sig: Buffer; seq: number; expires: number }

export class KlapClient {
  private session?: KlapSession;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(public host: string, private hashes: { v1: string; v2: string }[]) {}

  private url(path: string) { return `http://${this.host}/app/${path}`; }

  private async handshake(): Promise<KlapSession> {
    const localSeed = randomBytes(16);
    const r1 = await fetch(this.url('handshake1'), { method: 'POST', body: localSeed, signal: AbortSignal.timeout(5000) });
    if (!r1.ok) throw new Error(`handshake1 failed (HTTP ${r1.status})`);
    const body = Buffer.from(await r1.arrayBuffer());
    const remoteSeed = body.subarray(0, 16), serverHash = body.subarray(16, 48);
    const cookieHeader = r1.headers.get('set-cookie') ?? '';
    const cookie = /TP_SESSIONID=([^;]+)/.exec(cookieHeader)?.[1] ?? '';
    const timeout = Number(/TIMEOUT=(\d+)/.exec(cookieHeader)?.[1] ?? 86400);

    // Find which credentials (and KLAP version) the device used.
    let auth: Buffer | undefined, v2 = true;
    for (const h of this.hashes) {
      const a2 = Buffer.from(h.v2, 'hex'), a1 = Buffer.from(h.v1, 'hex');
      if (sha256(localSeed, remoteSeed, a2).equals(serverHash)) { auth = a2; v2 = true; break; }
      if (sha256(localSeed, a1).equals(serverHash)) { auth = a1; v2 = false; break; }
    }
    if (!auth) throw new KasaAuthError();

    const confirm = v2 ? sha256(remoteSeed, localSeed, auth) : sha256(remoteSeed, auth);
    const r2 = await fetch(this.url('handshake2'), {
      method: 'POST', body: confirm, headers: { Cookie: `TP_SESSIONID=${cookie}` }, signal: AbortSignal.timeout(5000),
    });
    if (!r2.ok) throw new Error(`handshake2 failed (HTTP ${r2.status})`);

    const local = Buffer.concat([localSeed, remoteSeed, auth]);
    const ivFull = sha256(Buffer.from('iv'), local);
    return {
      cookie,
      key: sha256(Buffer.from('lsk'), local).subarray(0, 16),
      iv: ivFull.subarray(0, 12),
      seq: ivFull.readInt32BE(28),
      sig: sha256(Buffer.from('ldk'), local).subarray(0, 28),
      expires: Date.now() + Math.max(60, timeout - 1200) * 1000,
    };
  }

  /** Sends one JSON request and returns the decrypted JSON reply. Requests are serialized (the sequence number must be in order). */
  send(payload: unknown): Promise<unknown> {
    const run = this.queue.then(() => this.sendNow(payload, true));
    this.queue = run.catch(() => {});
    return run;
  }

  private async sendNow(payload: unknown, retry: boolean): Promise<unknown> {
    if (!this.session || this.session.expires < Date.now()) this.session = await this.handshake();
    const s = this.session;
    s.seq = (s.seq + 1) | 0;
    const seqBuf = Buffer.alloc(4); seqBuf.writeInt32BE(s.seq);
    const iv = Buffer.concat([s.iv, seqBuf]);
    const c = createCipheriv('aes-128-cbc', s.key, iv);
    const cipher = Buffer.concat([c.update(Buffer.from(JSON.stringify(payload))), c.final()]);
    const signature = sha256(s.sig, seqBuf, cipher);

    const res = await fetch(`${this.url('request')}?seq=${s.seq}`, {
      method: 'POST', body: Buffer.concat([signature, cipher]),
      headers: { Cookie: `TP_SESSIONID=${s.cookie}` }, signal: AbortSignal.timeout(5000),
    });
    if (res.status === 403 && retry) { this.session = undefined; return this.sendNow(payload, false); }
    if (!res.ok) throw new Error(`request failed (HTTP ${res.status})`);
    const data = Buffer.from(await res.arrayBuffer());
    const d = createDecipheriv('aes-128-cbc', s.key, iv);
    return JSON.parse(Buffer.concat([d.update(data.subarray(32)), d.final()]).toString('utf8'));
  }
}

export class KasaAuthError extends Error {
  constructor() { super('The switch rejected the TP-Link login. Check the email and password you use in the Kasa app.'); }
}

// ---------------------------------------------------------------------------------------------
// Legacy XOR transport (port 9999)
// ---------------------------------------------------------------------------------------------

export function xorEncrypt(text: string): Buffer {
  let key = 171;
  return Buffer.from([...Buffer.from(text)].map((b) => (key = key ^ b)));
}
export function xorDecrypt(buf: Buffer): string {
  let key = 171;
  return Buffer.from([...buf].map((b) => { const p = key ^ b; key = b; return p; })).toString('utf8');
}

function legacySend(host: string, payload: unknown): Promise<unknown> {
  const [ip, port] = splitHost(host, 9999);
  return new Promise((resolve, reject) => {
    const sock = new Socket();
    const chunks: Buffer[] = [];
    sock.setTimeout(4000, () => { sock.destroy(); reject(new Error('timeout')); });
    sock.on('error', reject);
    sock.connect(port, ip, () => {
      const body = xorEncrypt(JSON.stringify(payload));
      const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
      sock.write(Buffer.concat([len, body]));
    });
    sock.on('data', (d) => {
      chunks.push(d);
      const all = Buffer.concat(chunks);
      if (all.length >= 4 && all.length >= 4 + all.readUInt32BE(0)) {
        sock.end();
        try { resolve(JSON.parse(xorDecrypt(all.subarray(4, 4 + all.readUInt32BE(0))))); } catch (e) { reject(e); }
      }
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Device: one switch/plug, whatever protocol it speaks
// ---------------------------------------------------------------------------------------------

const decodeNickname = (n: unknown) => {
  if (typeof n !== 'string') return '';
  try { const s = Buffer.from(n, 'base64').toString('utf8'); return /^[\x20-\x7e -￿]+$/.test(s) ? s : n; } catch { return n; }
};

export class KasaDevice {
  private klap?: KlapClient;

  constructor(public host: string, public protocol: KasaProtocol, hashes: { v1: string; v2: string }[]) {
    if (protocol !== 'legacy') this.klap = new KlapClient(host, [...hashes, ...FALLBACK_HASHES]);
  }

  async info(): Promise<KasaInfo> {
    if (this.protocol === 'klap-smart') {
      const r = await this.klap!.send({ method: 'get_device_info', params: null, request_time_milis: Date.now(), terminal_uuid: TERMINAL }) as SmartReply;
      if (r.error_code !== 0 || !r.result) throw new Error(`device error ${r.error_code}`);
      const x = r.result;
      return { host: this.host, protocol: this.protocol, on: Boolean(x.device_on), alias: decodeNickname(x.nickname) || String(x.model ?? 'Kasa switch'), model: String(x.model ?? ''), mac: x.mac as string | undefined };
    }
    const r = await this.iot({ system: { get_sysinfo: {} } }) as { system?: { get_sysinfo?: Record<string, unknown> } };
    const x = r.system?.get_sysinfo;
    if (!x) throw new Error('unexpected reply');
    return { host: this.host, protocol: this.protocol, on: Number(x.relay_state) === 1, alias: String(x.alias ?? 'Kasa switch'), model: String(x.model ?? ''), mac: (x.mac ?? x.mic_mac) as string | undefined };
  }

  async setOn(on: boolean) {
    if (this.protocol === 'klap-smart') {
      const r = await this.klap!.send({ method: 'set_device_info', params: { device_on: on }, request_time_milis: Date.now(), terminal_uuid: TERMINAL }) as SmartReply;
      if (r.error_code !== 0) throw new Error(`device error ${r.error_code}`);
      return;
    }
    await this.iot({ system: { set_relay_state: { state: on ? 1 : 0 } } });
  }

  private iot(payload: unknown) {
    return this.protocol === 'legacy' ? legacySend(this.host, payload) : this.klap!.send(payload);
  }
}

interface SmartReply { error_code: number; result?: Record<string, unknown> }
const TERMINAL = randomBytes(16).toString('base64');

/** Works out how to talk to a device at `host` by trying each protocol in turn. */
export async function probe(host: string, hashes: { v1: string; v2: string }[]): Promise<KasaInfo> {
  let authError: Error | undefined;
  for (const protocol of ['klap-smart', 'klap-iot', 'legacy'] as const) {
    try { return await new KasaDevice(protocol === 'legacy' ? host.replace(/:\d+$/, '') : host, protocol, hashes).info(); }
    catch (e) { if (e instanceof KasaAuthError) authError = e; }
  }
  throw authError ?? new Error(`No Kasa device answered at ${host}. Check the IP address in the Kasa app (Device settings → Device info).`);
}

// ---------------------------------------------------------------------------------------------
// Discovery: UDP broadcast on the local network
// ---------------------------------------------------------------------------------------------

export interface Discovered { host: string; model: string; mac?: string; alias?: string; protocol: KasaProtocol }

/** Classic 16-byte discovery query used by python-kasa for newer devices (port 20002). */
const QUERY_20002 = Buffer.from('020000010000000000000000463cb5d3', 'hex');
const QUERY_9999 = xorEncrypt(JSON.stringify({ system: { get_sysinfo: {} } }));

export function discover(broadcast = process.env.KASA_BROADCAST ?? '255.255.255.255', ms = 3000): Promise<Discovered[]> {
  return new Promise((resolve) => {
    const found = new Map<string, Discovered>();
    const sock = createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', () => { sock.close(); resolve([...found.values()]); });
    sock.on('message', (msg, rinfo) => {
      try {
        if (rinfo.port === 9999) {
          const x = JSON.parse(xorDecrypt(msg))?.system?.get_sysinfo;
          if (x && !found.has(rinfo.address)) found.set(rinfo.address, { host: rinfo.address, model: x.model, alias: x.alias, mac: x.mac ?? x.mic_mac, protocol: 'legacy' });
        } else {
          const r = JSON.parse(msg.subarray(16).toString('utf8'))?.result;
          if (!r) return;
          const port = r.mgt_encrypt_schm?.http_port;
          const host = port && port !== 80 ? `${r.ip ?? rinfo.address}:${port}` : (r.ip ?? rinfo.address);
          found.set(rinfo.address, {
            host, model: r.device_model ?? r.device_type ?? 'Kasa device', mac: r.mac,
            protocol: String(r.device_type ?? '').startsWith('SMART.') ? 'klap-smart' : 'klap-iot',
          });
        }
      } catch { /* not a Kasa reply */ }
    });
    sock.bind(0, () => {
      sock.setBroadcast(true);
      const blast = () => {
        sock.send(QUERY_20002, 20002, broadcast);
        sock.send(QUERY_9999, 9999, broadcast);
      };
      blast();
      setTimeout(blast, 1000);
    });
    setTimeout(() => { try { sock.close(); } catch { /* already closed */ } resolve([...found.values()]); }, ms);
  });
}

function splitHost(host: string, defaultPort: number): [string, number] {
  const m = /^(.*?)(?::(\d+))?$/.exec(host)!;
  return [m[1], m[2] ? Number(m[2]) : defaultPort];
}
