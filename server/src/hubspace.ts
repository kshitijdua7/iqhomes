import { createHash, randomBytes } from 'node:crypto';

/**
 * Hubspace (Home Depot) cloud client.
 *
 * Hubspace has no official public API. This follows the same flow the Hubspace phone app uses, as documented by
 * the open-source community integrations (hubspace-homeassistant / aioafero):
 *   1. Sign in once with email + password through Hubspace's login page (OAuth + PKCE) → refresh token
 *   2. Refresh token → short-lived access token (renewed automatically)
 *   3. Afero cloud API: list "metadevices" with their state, and PUT new state values (e.g. power on/off)
 *
 * The password is only used for step 1 and is never stored. Only the refresh token is saved (git-ignored).
 */

const AUTH = process.env.HUBSPACE_AUTH_URL ?? 'https://accounts.hubspaceconnect.com';
const API = process.env.HUBSPACE_API_URL ?? 'https://api2.afero.net';
const STATE_API = process.env.HUBSPACE_STATE_URL ?? 'https://semantics2.afero.net';
const REALM = `${AUTH}/auth/realms/thd`;
const CLIENT_ID = 'hubspace_android';
const REDIRECT = 'hubspace-app://loginredirect';
const UA = 'Dart/3.1 (dart:io)';

export interface HubspaceTokens { refreshToken: string; accountId: string }

export interface HubspaceDevice {
  id: string;
  name: string;
  deviceClass: string;       // 'switch', 'light', 'fan', 'power-outlet', …
  model?: string;
  on?: boolean;              // undefined if it has no power function
  powerInstance?: string | null;
  online?: boolean;
}

export class HubspaceError extends Error {}

const b64url = (b: Buffer) => b.toString('base64url');

/** Collects Set-Cookie headers so the login page and the login POST share a session. */
function cookieJar() {
  const jar = new Map<string, string>();
  return {
    take(res: Response) {
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    },
    header: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
  };
}

/** Step 1: email + password → refresh token and account id. */
export async function hubspaceLogin(email: string, password: string): Promise<HubspaceTokens> {
  const verifier = b64url(randomBytes(40));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const jar = cookieJar();

  const authUrl = new URL(`${REALM}/protocol/openid-connect/auth`);
  for (const [k, v] of Object.entries({
    response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT,
    code_challenge: challenge, code_challenge_method: 'S256', scope: 'openid offline_access',
  })) authUrl.searchParams.set(k, v);

  const page = await fetch(authUrl, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  jar.take(page);
  const html = await page.text();
  const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(html)?.[1] ?? /action="([^"]*login-actions\/authenticate[^"]*)"/.exec(html)?.[1];
  if (!action) throw new HubspaceError('Could not open the Hubspace sign-in page. Hubspace may have changed their login.');

  const login = await fetch(action.replace(/&amp;/g, '&'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: jar.header(), 'User-Agent': UA },
    body: new URLSearchParams({ username: email, password, credentialId: '' }),
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  const location = login.headers.get('location') ?? '';
  const code = /[?&]code=([^&]+)/.exec(location)?.[1];
  if (!code) {
    const body = await login.text().catch(() => '');
    if (/otp|one-time|verification code/i.test(body)) throw new HubspaceError('Your Hubspace account asks for a verification code. Turn off two-step sign-in in the Hubspace app and try again.');
    throw new HubspaceError('Hubspace didn’t accept that email and password.');
  }

  const tok = await tokenRequest({ grant_type: 'authorization_code', code: decodeURIComponent(code), redirect_uri: REDIRECT, code_verifier: verifier, client_id: CLIENT_ID });
  const me = await fetch(`${API}/v1/users/me`, { headers: { Authorization: `Bearer ${tok.access_token}`, 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
  if (!me.ok) throw new HubspaceError(`Signed in, but couldn't read your Hubspace account (HTTP ${me.status}).`);
  const user = await me.json() as { accountAccess?: { account?: { accountId?: string } }[] };
  const accountId = user.accountAccess?.[0]?.account?.accountId;
  if (!accountId) throw new HubspaceError('Signed in, but no Hubspace home was found on this account.');
  return { refreshToken: tok.refresh_token, accountId };
}

async function tokenRequest(form: Record<string, string>) {
  const res = await fetch(`${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new HubspaceError(res.status === 400 || res.status === 401 ? 'expired' : `Hubspace sign-in failed (HTTP ${res.status})`);
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
}

/** Steps 2–3: an authenticated client for one Hubspace account. */
export class HubspaceClient {
  private access?: { token: string; expires: number };

  constructor(public tokens: HubspaceTokens, private onTokens: (t: HubspaceTokens) => void) {}

  private async token() {
    if (this.access && this.access.expires > Date.now()) return this.access.token;
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: this.tokens.refreshToken, client_id: CLIENT_ID, scope: 'openid email offline_access profile' });
    this.access = { token: t.access_token, expires: Date.now() + (t.expires_in - 30) * 1000 };
    if (t.refresh_token && t.refresh_token !== this.tokens.refreshToken) {
      this.tokens = { ...this.tokens, refreshToken: t.refresh_token };
      this.onTokens(this.tokens);
    }
    return t.access_token;
  }

  private async call(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${await this.token()}`, 'User-Agent': UA, 'Content-Type': 'application/json', ...init.headers },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 && retry) { this.access = undefined; return this.call(url, init, false); }
    return res;
  }

  async devices(): Promise<HubspaceDevice[]> {
    // device list + state live on the "semantics" host (api2 answers 404 for this path)
    const res = await this.call(`${STATE_API}/v1/accounts/${this.tokens.accountId}/metadevices?expansions=state`);
    if (!res.ok) throw new HubspaceError(`Couldn't list Hubspace devices (HTTP ${res.status})`);
    const list = await res.json() as RawDevice[];
    return list.filter((d) => d.typeId === 'metadevice.device').map(parseDevice);
  }

  async setPower(deviceId: string, on: boolean, instance: string | null | undefined) {
    const body = JSON.stringify({
      metadeviceId: deviceId,
      values: [{ functionClass: 'power', functionInstance: instance ?? null, lastUpdateTime: Date.now(), value: on ? 'on' : 'off' }],
    });
    const path = `/v1/accounts/${this.tokens.accountId}/metadevices/${deviceId}/state`;
    let res = await this.call(`${STATE_API}${path}`, { method: 'PUT', body });
    if (!res.ok && STATE_API !== API) res = await this.call(`${API}${path}`, { method: 'PUT', body });
    if (!res.ok) throw new HubspaceError(`Hubspace refused the change (HTTP ${res.status})`);
  }
}

interface RawDevice {
  id: string;
  typeId: string;
  friendlyName?: string;
  description?: { device?: { deviceClass?: string; model?: string; defaultName?: string } };
  state?: { values?: { functionClass: string; functionInstance?: string | null; value: unknown }[] };
}

function parseDevice(d: RawDevice): HubspaceDevice {
  const values = d.state?.values ?? [];
  const power = values.find((v) => v.functionClass === 'power');
  const avail = values.find((v) => v.functionClass === 'available');
  return {
    id: d.id,
    name: d.friendlyName || d.description?.device?.defaultName || 'Hubspace device',
    deviceClass: d.description?.device?.deviceClass ?? 'unknown',
    model: d.description?.device?.model,
    on: power ? power.value === 'on' : undefined,
    powerInstance: power?.functionInstance ?? null,
    online: avail ? avail.value !== false : true,
  };
}
