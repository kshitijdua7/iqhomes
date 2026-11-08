import { useCallback, useEffect, useState } from 'react';
import { api, type Session } from '../session';
import type { Room } from '../types';

interface Status {
  connected: boolean;
  email?: string;
  devices: { id: string; name: string; room: string; host: string; model?: string; online: boolean }[];
}
interface Found { host: string; model: string; mac?: string; alias?: string; protocol: string; added?: string }
interface Probed { host: string; alias: string; model: string; on: boolean }

/**
 * "Smart switches" panel (owner only): link the TP-Link/Kasa account once, find switches on the Wi-Fi,
 * name them, pick a room, and Nova can control them straight away.
 */
export function KasaPanel({ session, rooms }: { session: Session; rooms: Room[] }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [step, setStep] = useState<'idle' | 'account' | 'scan'>('idle');
  const [error, setError] = useState<string | null>(null);
  const token = session.token;

  const refresh = useCallback(() => api<Status>('/api/kasa', { token }).then(setStatus).catch(() => {}), [token]);
  useEffect(() => { void refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);

  if (!status) return null;

  return (
    <section className="glass rounded-3xl p-5">
      <header className="flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-white/60">Smart switches</h2>
        {status.connected && step === 'idle' && (
          <button onClick={() => { setStep('scan'); setError(null); }} className="rounded-full bg-white/8 px-3 py-1 text-xs hover:bg-white/15">+ Add switch</button>
        )}
        {step !== 'idle' && <button onClick={() => setStep('idle')} className="rounded-full bg-white/8 px-3 py-1 text-xs hover:bg-white/15">Close</button>}
      </header>

      {!status.connected && step === 'idle' && (
        <div className="mt-3">
          <p className="text-xs leading-relaxed text-white/50">Control your TP-Link Kasa switches (like the KS205) with Nova. IQHomes talks to them directly on your Wi-Fi.</p>
          <button onClick={() => { setStep('account'); setError(null); }}
                  className="mt-3 w-full rounded-full bg-gradient-to-r from-nova to-nova-2 py-2 text-sm font-medium">Connect Kasa</button>
        </div>
      )}

      {step === 'account' && <AccountForm token={token} onDone={() => { void refresh(); setStep('scan'); }} />}
      {step === 'scan' && <AddSwitch token={token} rooms={rooms} onAdded={() => { void refresh(); setStep('idle'); }} setError={setError} />}
      {error && <p role="alert" className="mt-3 text-xs text-amber-300">{error}</p>}

      {status.devices.length > 0 && (
        <ul className="mt-4 space-y-2">
          {status.devices.map((d) => <DeviceRow key={d.id} d={d} rooms={rooms} token={token} onChange={refresh} />)}
        </ul>
      )}

      {status.connected && step === 'idle' && (
        <div className="mt-3 flex items-center justify-between text-[11px] text-white/35">
          <span className="truncate">Kasa account: {status.email}</span>
          <button onClick={() => setStep('account')} className="shrink-0 hover:text-white/70">Change</button>
        </div>
      )}
    </section>
  );
}

function AccountForm({ token, onDone }: { token: string; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await api('/api/kasa/account', { body: { email, password }, token }); onDone(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} className="fade-in mt-4 space-y-2.5">
      <p className="text-xs leading-relaxed text-white/50">Sign in with the <b className="text-white/80">same email and password you use in the Kasa app</b>. Newer Kasa switches use it to encrypt the connection on your Wi-Fi. Only a one-way hash is saved on this computer, never the password.</p>
      <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="TP-Link / Kasa email"
             className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-nova/60" />
      <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password"
             className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-nova/60" />
      {error && <p className="text-xs text-amber-300">{error}</p>}
      <button disabled={busy} className="w-full rounded-full bg-gradient-to-r from-nova to-nova-2 py-2 text-sm font-medium disabled:opacity-60">{busy ? 'Saving…' : 'Save & find my switches'}</button>
    </form>
  );
}

function AddSwitch({ token, rooms, onAdded, setError }: { token: string; rooms: Room[]; onAdded: () => void; setError: (e: string | null) => void }) {
  const [scanning, setScanning] = useState(true);
  const [found, setFound] = useState<Found[]>([]);
  const [manual, setManual] = useState('');
  const [picked, setPicked] = useState<Probed | null>(null);
  const [busy, setBusy] = useState(false);

  const scan = useCallback(async () => {
    setScanning(true); setError(null);
    try { setFound(await api<Found[]>('/api/kasa/scan', { body: {}, token })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Scan failed'); }
    finally { setScanning(false); }
  }, [token, setError]);
  useEffect(() => { void scan(); }, [scan]);

  async function choose(host: string) {
    setBusy(true); setError(null);
    try { setPicked(await api<Probed>('/api/kasa/probe', { body: { host }, token })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not connect'); }
    finally { setBusy(false); }
  }

  if (picked) return <NameSwitch token={token} rooms={rooms} probed={picked} onBack={() => setPicked(null)} onAdded={onAdded} setError={setError} />;

  return (
    <div className="fade-in mt-4 space-y-3">
      <div className="flex items-center justify-between text-xs text-white/50">
        <span>{scanning ? 'Looking for Kasa switches on your Wi-Fi…' : found.length ? `Found ${found.length}` : 'No switches found automatically.'}</span>
        {!scanning && <button onClick={scan} className="text-white/60 hover:text-white">Scan again</button>}
      </div>
      {scanning && <div className="h-1 overflow-hidden rounded-full bg-white/5"><div className="h-full w-1/3 animate-[scan_1.2s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-nova to-nova-2" /></div>}
      <ul className="space-y-2">
        {found.map((f) => (
          <li key={f.host}>
            <button disabled={!!f.added || busy} onClick={() => choose(f.host)}
                    className="flex w-full items-center gap-3 rounded-2xl bg-white/5 px-3 py-2.5 text-left transition-colors enabled:hover:bg-white/10 disabled:opacity-50">
              <span className="text-lg">🔘</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{f.alias ?? f.model}</span>
                <span className="block text-[11px] text-white/40">{f.model} · {f.host}</span>
              </span>
              <span className="text-[11px] text-white/50">{f.added ? `Added as ${f.added}` : busy ? '…' : 'Add ›'}</span>
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={(e) => { e.preventDefault(); if (manual.trim()) void choose(manual.trim()); }} className="space-y-1.5">
        <div className="text-[11px] text-white/40">Not listed? Enter its IP address (Kasa app → the switch → ⚙️ → Device info):</div>
        <div className="flex gap-2">
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="192.168.0.42" inputMode="decimal"
                 className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-nova/60" />
          <button disabled={busy || !manual.trim()} className="rounded-xl bg-white/10 px-4 text-sm hover:bg-white/15 disabled:opacity-50">{busy ? '…' : 'Connect'}</button>
        </div>
      </form>
    </div>
  );
}

function NameSwitch({ token, rooms, probed, onBack, onAdded, setError }: {
  token: string; rooms: Room[]; probed: Probed; onBack: () => void; onAdded: () => void; setError: (e: string | null) => void;
}) {
  const [name, setName] = useState(probed.alias);
  const [room, setRoom] = useState(rooms.find((r) => probed.alias.toLowerCase().includes(r.name.split(' ')[0].toLowerCase()))?.id ?? rooms[0]?.id);
  const [kind, setKind] = useState<'light' | 'plug'>('light');
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true); setError(null);
    try { await api('/api/kasa/devices', { body: { host: probed.host, name, room, kind }, token }); onAdded(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not add'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fade-in mt-4 space-y-3">
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2.5 text-sm">
        <span>✅</span>
        <span className="flex-1">Connected to <b>{probed.alias}</b> ({probed.model}). It's {probed.on ? 'on' : 'off'} right now.</span>
      </div>
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
      <p className="text-[11px] text-white/40">Then try: <i className="text-white/70">“Hey Nova, turn on the {name.trim().toLowerCase() || 'switch'}”</i></p>
      <div className="flex gap-2">
        <button onClick={onBack} className="rounded-full px-4 py-2 text-sm text-white/60 hover:bg-white/10">Back</button>
        <button onClick={add} disabled={busy || !name.trim()} className="flex-1 rounded-full bg-gradient-to-r from-nova to-nova-2 py-2 text-sm font-medium disabled:opacity-60">{busy ? 'Adding…' : 'Add to IQHomes'}</button>
      </div>
    </div>
  );
}

function DeviceRow({ d, rooms, token, onChange }: { d: Status['devices'][number]; rooms: Room[]; token: string; onChange: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const remove = async () => { await api(`/api/kasa/devices/${d.id}`, { method: 'DELETE', token }).catch(() => {}); onChange(); };
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-white/4 px-3 py-2">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${d.online ? 'bg-emerald-400 shadow-[0_0_10px] shadow-emerald-400' : 'bg-red-400'}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{d.name}</div>
        <div className="truncate text-[11px] text-white/40">{rooms.find((r) => r.id === d.room)?.name} · {d.model} · {d.online ? d.host : 'offline'}</div>
      </div>
      {confirm
        ? <><button onClick={remove} className="rounded-full px-2 py-1 text-[11px] text-red-300 hover:bg-red-400/10">Remove</button>
            <button onClick={() => setConfirm(false)} className="rounded-full px-2 py-1 text-[11px] text-white/50 hover:bg-white/10">Keep</button></>
        : <button onClick={() => setConfirm(true)} aria-label={`Remove ${d.name}`} className="rounded-full px-2 py-1 text-[11px] text-white/40 hover:bg-white/10">✕</button>}
    </li>
  );
}
