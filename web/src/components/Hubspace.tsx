import { useCallback, useEffect, useState } from 'react';
import { api, type Session } from '../session';
import type { Room } from '../types';

interface Status {
  connected: boolean;
  expired: boolean;
  email?: string;
  devices: { id: string; name: string; room: string; model?: string; online: boolean }[];
}
interface Available { id: string; name: string; deviceClass: string; model?: string; on?: boolean; added?: string }

/** Hubspace (Home Depot) panel, owner only: sign in once, pick devices from your account, Nova controls them. */
export function HubspacePanel({ session, rooms }: { session: Session; rooms: Room[] }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [step, setStep] = useState<'idle' | 'signin' | 'pick'>('idle');
  const token = session.token;

  const refresh = useCallback(() => api<Status>('/api/hubspace', { token }).then(setStatus).catch(() => {}), [token]);
  useEffect(() => { void refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);

  if (!status) return null;
  const needsSignIn = !status.connected;

  return (
    <section className="glass rounded-3xl p-5">
      <header className="flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-white/60">Hubspace</h2>
        {status.connected && step === 'idle' && <button onClick={() => setStep('pick')} className="rounded-full bg-white/8 px-3 py-1 text-xs hover:bg-white/15">+ Add device</button>}
        {step !== 'idle' && <button onClick={() => setStep('idle')} className="rounded-full bg-white/8 px-3 py-1 text-xs hover:bg-white/15">Close</button>}
      </header>

      {needsSignIn && step === 'idle' && (
        <div className="mt-3">
          <p className="text-xs leading-relaxed text-white/50">
            {status.expired ? 'Your Hubspace sign-in expired. Sign in again to keep controlling your devices.' : 'Control your Hubspace (Home Depot) switches and lights with Nova.'}
          </p>
          <button onClick={() => setStep('signin')} className="mt-3 w-full rounded-full bg-gradient-to-r from-nova to-nova-2 py-2 text-sm font-medium">
            {status.expired ? 'Sign in again' : 'Connect Hubspace'}
          </button>
        </div>
      )}

      {step === 'signin' && <SignIn token={token} onDone={() => { void refresh(); setStep('pick'); }} />}
      {step === 'pick' && <Pick token={token} rooms={rooms} onAdded={() => { void refresh(); setStep('idle'); }} />}

      {status.devices.length > 0 && (
        <ul className="mt-4 space-y-2">
          {status.devices.map((d) => <Row key={d.id} d={d} rooms={rooms} token={token} onChange={refresh} />)}
        </ul>
      )}

      {status.connected && step === 'idle' && (
        <div className="mt-3 flex items-center justify-between text-[11px] text-white/35">
          <span className="truncate">Hubspace: {status.email}</span>
          <button onClick={async () => { await api('/api/hubspace/account', { method: 'DELETE', token }).catch(() => {}); void refresh(); }} className="shrink-0 hover:text-white/70">Disconnect</button>
        </div>
      )}
    </section>
  );
}

function SignIn({ token, onDone }: { token: string; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await api('/api/hubspace/account', { body: { email, password }, token }); onDone(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Sign-in failed'); }
    finally { setBusy(false); setPassword(''); }
  }

  return (
    <form onSubmit={submit} className="fade-in mt-4 space-y-2.5">
      <p className="text-xs leading-relaxed text-white/50">Use the <b className="text-white/80">same email and password as the Hubspace app</b>. The password is used once to sign in and is <b className="text-white/80">not saved</b>. IQHomes keeps only a sign-in token on this computer.</p>
      <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Hubspace email"
             className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-nova/60" />
      <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password"
             className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-nova/60" />
      {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}
      <button disabled={busy} className="w-full rounded-full bg-gradient-to-r from-nova to-nova-2 py-2 text-sm font-medium disabled:opacity-60">{busy ? 'Signing in to Hubspace…' : 'Sign in'}</button>
    </form>
  );
}

const ICON: Record<string, string> = { switch: '🔘', light: '💡', fan: '🌀', 'power-outlet': '🔌', plug: '🔌' };

function Pick({ token, rooms, onAdded }: { token: string; rooms: Room[]; onAdded: () => void }) {
  const [list, setList] = useState<Available[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Available | null>(null);
  const [name, setName] = useState('');
  const [room, setRoom] = useState(rooms[0]?.id);
  const [kind, setKind] = useState<'light' | 'plug'>('light');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Available[]>('/api/hubspace/available', { token }).then(setList).catch((e) => setError(e instanceof Error ? e.message : 'Could not load devices'));
  }, [token]);

  async function add() {
    if (!picked) return;
    setBusy(true); setError(null);
    try { await api('/api/hubspace/devices', { body: { hubId: picked.id, name, room, kind }, token }); onAdded(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not add'); }
    finally { setBusy(false); }
  }

  if (picked) {
    return (
      <div className="fade-in mt-4 space-y-3">
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wider text-white/40">Name (what you'll say to Nova)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32}
                 className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-nova/60" />
        </label>
        <div>
          <span className="mb-1.5 block text-[11px] uppercase tracking-wider text-white/40">Room</span>
          <div className="flex flex-wrap gap-1.5">
            {rooms.map((r) => (
              <button key={r.id} onClick={() => setRoom(r.id)}
                      className={`rounded-full px-2.5 py-1 text-xs transition-colors ${room === r.id ? 'bg-nova text-white' : 'bg-white/6 text-white/60 hover:bg-white/12'}`}>{r.icon} {r.name}</button>
            ))}
          </div>
        </div>
        <div>
          <span className="mb-1.5 block text-[11px] uppercase tracking-wider text-white/40">It controls</span>
          <div className="flex gap-1.5">
            {([['light', '💡 A light'], ['plug', '🔌 Something else']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setKind(k)}
                      className={`flex-1 rounded-full px-2 py-1 text-xs transition-colors ${kind === k ? 'bg-white/15 text-white' : 'bg-white/5 text-white/55 hover:bg-white/10'}`}>{label}</button>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-white/40">Then try: <i className="text-white/70">“Hey Nova, turn on the {name.trim().toLowerCase() || 'light'}”</i></p>
        {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}
        <div className="flex gap-2">
          <button onClick={() => setPicked(null)} className="rounded-full px-4 py-2 text-sm text-white/60 hover:bg-white/10">Back</button>
          <button onClick={add} disabled={busy || !name.trim()} className="flex-1 rounded-full bg-gradient-to-r from-nova to-nova-2 py-2 text-sm font-medium disabled:opacity-60">{busy ? 'Adding…' : 'Add to IQHomes'}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in mt-4 space-y-2">
      <div className="text-xs text-white/50">{list ? (list.length ? 'Your Hubspace devices. Tap one to add it:' : 'No devices found on this Hubspace account.') : 'Loading your Hubspace devices…'}</div>
      {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}
      <ul className="space-y-2">
        {list?.map((d) => {
          const usable = d.on !== undefined && !d.added;
          return (
            <li key={d.id}>
              <button disabled={!usable} onClick={() => { setPicked(d); setName(d.name); }}
                      className="flex w-full items-center gap-3 rounded-2xl bg-white/5 px-3 py-2.5 text-left transition-colors enabled:hover:bg-white/10 disabled:opacity-50">
                <span className="text-lg">{ICON[d.deviceClass] ?? '🏷️'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{d.name}</span>
                  <span className="block text-[11px] text-white/40">{d.deviceClass}{d.model ? ` · ${d.model}` : ''}{d.on !== undefined ? ` · ${d.on ? 'on' : 'off'}` : ''}</span>
                </span>
                <span className="text-[11px] text-white/50">{d.added ? `Added as ${d.added}` : d.on === undefined ? 'Not supported yet' : 'Add ›'}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Row({ d, rooms, token, onChange }: { d: Status['devices'][number]; rooms: Room[]; token: string; onChange: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const remove = async () => { await api(`/api/hubspace/devices/${d.id}`, { method: 'DELETE', token }).catch(() => {}); onChange(); };
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-white/4 px-3 py-2">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${d.online ? 'bg-emerald-400 shadow-[0_0_10px] shadow-emerald-400' : 'bg-red-400'}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{d.name}</div>
        <div className="truncate text-[11px] text-white/40">{rooms.find((r) => r.id === d.room)?.name}{d.model ? ` · ${d.model}` : ''} · {d.online ? 'online' : 'offline'}</div>
      </div>
      {confirm
        ? <><button onClick={remove} className="rounded-full px-2 py-1 text-[11px] text-red-300 hover:bg-red-400/10">Remove</button>
            <button onClick={() => setConfirm(false)} className="rounded-full px-2 py-1 text-[11px] text-white/50 hover:bg-white/10">Keep</button></>
        : <button onClick={() => setConfirm(true)} aria-label={`Remove ${d.name}`} className="rounded-full px-2 py-1 text-[11px] text-white/40 hover:bg-white/10">✕</button>}
    </li>
  );
}
