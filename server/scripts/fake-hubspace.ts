/**
 * A pretend Hubspace cloud (login page + device API) with one wall switch, for demos and testing.
 *
 *   npm run fake-hubspace --prefix server
 *   then start IQHomes with: HUBSPACE_AUTH_URL=http://localhost:8090 HUBSPACE_API_URL=http://localhost:8090 HUBSPACE_STATE_URL=http://localhost:8090
 *
 * Login: demo@iqhomes.dev / demo1234. Press ENTER to flip the switch "on the wall".
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';

const PORT = Number(process.env.HUBSPACE_PORT ?? 8090);
const EMAIL = 'demo@iqhomes.dev', PASSWORD = 'demo1234', ACCOUNT = 'acct-123', DEVICE = 'dev-room-switch-9f2a';
let on = false;
const pending = new Map<string, string>(); // auth code -> PKCE challenge
const refreshTokens = new Set<string>(), accessTokens = new Set<string>();
const show = () => console.log(`💡 Room Switch is ${on ? 'ON  ████' : 'OFF ░░░░'}`);

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const body = Buffer.concat(chunks).toString();
    const form = new URLSearchParams(body);
    const json = (code: number, data: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    const authed = accessTokens.has((req.headers.authorization ?? '').replace('Bearer ', ''));

    if (url.pathname.endsWith('/openid-connect/auth')) {
      const challenge = url.searchParams.get('code_challenge') ?? '';
      res.writeHead(200, { 'Set-Cookie': `AUTH_SESSION_ID=${randomBytes(8).toString('hex')}; Path=/`, 'Content-Type': 'text/html' });
      return res.end(`<html><form id="kc-form-login" action="http://localhost:${PORT}/auth/realms/thd/login-actions/authenticate?session_code=abc&amp;execution=x&amp;client_id=hubspace_android&amp;tab_id=t&amp;c=${encodeURIComponent(challenge)}" method="post"></form></html>`);
    }
    if (url.pathname.endsWith('/login-actions/authenticate')) {
      if (!req.headers.cookie?.includes('AUTH_SESSION_ID')) return json(400, { error: 'no session' });
      if (form.get('username') !== EMAIL || form.get('password') !== PASSWORD) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<span>Invalid username or password.</span>'); }
      const code = randomBytes(8).toString('hex');
      pending.set(code, url.searchParams.get('c') ?? '');
      res.writeHead(302, { Location: `hubspace-app://loginredirect?session_state=s&code=${code}` });
      return res.end();
    }
    if (url.pathname.endsWith('/openid-connect/token')) {
      if (form.get('grant_type') === 'authorization_code') {
        const challenge = pending.get(form.get('code') ?? '');
        const ok = challenge && createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') === challenge;
        if (!ok) return json(400, { error: 'invalid_grant' });
        pending.delete(form.get('code')!);
      } else if (!refreshTokens.has(form.get('refresh_token') ?? '')) return json(400, { error: 'invalid_grant' });
      const access = randomBytes(12).toString('hex'), refresh = randomBytes(12).toString('hex');
      accessTokens.add(access); refreshTokens.add(refresh);
      return json(200, { access_token: access, refresh_token: refresh, expires_in: 120 });
    }
    if (!authed) return json(401, { error: 'unauthorized' });
    if (url.pathname === '/v1/users/me') return json(200, { accountAccess: [{ account: { accountId: ACCOUNT } }] });
    if (url.pathname === `/v1/accounts/${ACCOUNT}/metadevices`) {
      return json(200, [
        { id: 'home-1', typeId: 'metadevice.home', friendlyName: 'My Home' },
        {
          id: DEVICE, typeId: 'metadevice.device', friendlyName: 'Room Switch',
          description: { device: { deviceClass: 'switch', model: 'HPSA11CWB', defaultName: 'Switch' } },
          state: { values: [{ functionClass: 'power', functionInstance: null, value: on ? 'on' : 'off' }, { functionClass: 'available', value: true }] },
        },
      ]);
    }
    if (url.pathname === `/v1/accounts/${ACCOUNT}/metadevices/${DEVICE}/state` && req.method === 'PUT') {
      const v = JSON.parse(body).values?.find((x: { functionClass: string }) => x.functionClass === 'power');
      if (v) { on = v.value === 'on'; show(); }
      return json(200, { ok: true });
    }
    json(404, { error: 'not found' });
  });
}).listen(PORT, () => { console.log(`☁️  Fake Hubspace cloud on http://localhost:${PORT} (login ${EMAIL} / ${PASSWORD}). Press ENTER to flip the wall switch.`); show(); });

createInterface({ input: process.stdin }).on('line', () => { on = !on; console.log('👆 flipped on the wall'); show(); });
