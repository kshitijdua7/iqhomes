import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ROLE_LABEL, timeLeft, type Session } from '../session';
import type { Device, HardwareInfo, PublicUser, Room } from '../types';
import type { Toast } from '../useHome';
import { useInstall, usePush } from '../usePwa';

/* ---------------- Guest passes (owner only) ---------------- */
export function PeoplePanel({ session, rooms }: { session: Session; rooms: Room[] }) {
  const [guests, setGuests] = useState<PublicUser[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>(['living']);
  const [hours, setHours] = useState(24);
  const [created, setCreated] = useState<{ user: PublicUser; code: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, force] = useState(0);

  const load = useCallback(() => api<PublicUser[]>('/api/guests', { token: session.token }).then(setGuests).catch(() => {}), [session.token]);
  useEffect(() => { void load(); const t = setInterval(() => force((n) => n + 1), 30_000); return () => clearInterval(t); }, [load]);

  async function create() {
    setError(null);
    try {
      const r = await api<{ user: PublicUser; code: string }>('/api/guests', { body: { name, rooms: picked, hours }, token: session.token });
      setCreated(r);
      setName('');
      void load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create pass'); }
  }

  async function revoke(id: string) {
    await api(`/api/guests/${id}`, { method: 'DELETE', token: session.token }).catch(() => {});
    void load();
  }

  const link = created ? `${location.origin}/?guest=${created.code}` : '';
  const share = async () => {
    const text = `Your IQHomes guest pass: code ${created?.code}\n${link}`;
    if (navigator.share) await navigator.share({ title: 'IQHomes guest pass', text }).catch(() => {});
    else await navigator.clipboard?.writeText(text).catch(() => {});
  };

  return (
    <section className="glass rounded-3xl p-5">
      <header className="flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-white/60">Guest passes</h2>
        <button onClick={() => { setOpen(!open); setCreated(null); }} className="rounded-full bg-white/8 px-3 py-1 text-xs hover:bg-white/15">
          {open ? 'Close' : '+ New pass'}
        </button>
      </header>

      {open && !created && (
        <div className="fade-in mt-4 space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Guest name (e.g. Alex)" maxLength={24}
                 className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-nova/60" />
          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-wider text-white/40">Rooms they can control</div>
            <div className="flex flex-wrap gap-1.5">
              {rooms.map((r) => {
                const on = picked.includes(r.id);
                return (
                  <button key={r.id} onClick={() => setPicked(on ? picked.filter((x) => x !== r.id) : [...picked, r.id])}
                          className={`rounded-full px-2.5 py-1 text-xs transition-colors ${on ? 'bg-nova text-white' : 'bg-white/6 text-white/60 hover:bg-white/12'}`}>
                    {r.icon} {r.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-wider text-white/40">Valid for</div>
            <div className="flex gap-1.5">
              {[[3, '3 hours'], [24, '1 day'], [72, '3 days'], [168, '1 week']].map(([h, label]) => (
                <button key={h} onClick={() => setHours(h as number)}
                        className={`flex-1 rounded-full px-2 py-1 text-xs transition-colors ${hours === h ? 'bg-white/15 text-white' : 'bg-white/5 text-white/55 hover:bg-white/10'}`}>{label}</button>
              ))}
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-white/40">Guests never see or control locks or the thermostat, can't run whole-house scenes, and lose access automatically when the pass expires.</p>
          {error && <p className="text-xs text-amber-300">{error}</p>}
          <button onClick={create} className="w-full rounded-full bg-gradient-to-r from-nova to-nova-2 py-2 text-sm font-medium">Create pass</button>
        </div>
      )}

      {created && (
        <div className="fade-in mt-4 rounded-2xl border border-nova/30 bg-nova/10 p-4 text-center">
          <div className="text-xs text-white/60">Pass for {created.user.name}. Shown once, share it now:</div>
          <div className="mt-2 font-display text-4xl font-semibold tracking-[0.3em] tabular-nums">{created.code}</div>
          <button onClick={share} className="mt-3 rounded-full bg-white/10 px-4 py-1.5 text-xs hover:bg-white/20">
            {'share' in navigator ? 'Share invite' : 'Copy invite link'}
          </button>
        </div>
      )}

      <ul className="mt-4 space-y-2">
        {guests.length === 0 && <li className="text-xs text-white/40">No active guest passes.</li>}
        {guests.map((g) => (
          <li key={g.id} className="flex items-center gap-3 rounded-2xl bg-white/4 px-3 py-2">
            <span className="text-lg">{g.avatar}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{g.name}</div>
              <div className="truncate text-[11px] text-white/45">
                {g.rooms?.map((r) => rooms.find((x) => x.id === r)?.name ?? r).join(', ')} · {g.expiresAt ? timeLeft(g.expiresAt) : ''}
              </div>
            </div>
            <button onClick={() => revoke(g.id)} className="rounded-full px-2.5 py-1 text-[11px] text-red-300 hover:bg-red-400/10">Revoke</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------- Real hardware (owner only) ---------------- */
export function HardwarePanel({ session, devices }: { session: Session; devices: Device[] }) {
  const [token, setToken] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const linked = devices.filter((d): d is Device & { hardware: HardwareInfo } => !!d.hardware);

  useEffect(() => {
    if (show && !token) api<{ token: string }>('/api/hardware', { token: session.token }).then((r) => setToken(r.token)).catch(() => {});
  }, [show, token, session.token]);

  return (
    <section className="glass rounded-3xl p-5">
      <header className="flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-white/60">Real hardware</h2>
        <button onClick={() => setShow(!show)} className="rounded-full bg-white/8 px-3 py-1 text-xs hover:bg-white/15">{show ? 'Hide' : 'Connect'}</button>
      </header>

      {linked.length === 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-white/45">No physical devices yet. Plug in an ESP32 or a Shelly/Tasmota smart plug, or run <code className="rounded bg-white/10 px-1">npm run fake-esp32</code> to try it.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {linked.map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded-2xl bg-white/4 px-3 py-2">
              <span className={`h-2.5 w-2.5 rounded-full ${d.hardware.online ? 'bg-emerald-400 shadow-[0_0_10px] shadow-emerald-400' : 'bg-red-400'}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{d.name}</div>
                <div className="text-[11px] uppercase tracking-wider text-white/40">{d.hardware.kind} · {d.hardware.online ? 'online' : 'offline'}</div>
              </div>
              <Telemetry t={d.hardware.telemetry} />
            </li>
          ))}
        </ul>
      )}

      {show && (
        <div className="fade-in mt-4 space-y-3 text-xs leading-relaxed text-white/60">
          <div>
            <div className="font-medium text-white/80">ESP32</div>
            Flash <code className="rounded bg-white/10 px-1">hardware/esp32-iqhomes</code>, set your Wi-Fi, this computer's IP and this token:
            <div className="mt-1.5 select-all break-all rounded-lg bg-black/40 px-2 py-1.5 font-mono text-[11px] text-aqua">{token ?? '…'}</div>
          </div>
          <div>
            <div className="font-medium text-white/80">Smart plug</div>
            Start the server with <code className="rounded bg-white/10 px-1">SHELLY_HOST=192.168.x.x</code> or <code className="rounded bg-white/10 px-1">TASMOTA_HOST=…</code>. It becomes the Coffee Maker and reports real watts.
          </div>
        </div>
      )}
    </section>
  );
}

export function Telemetry({ t }: { t?: Record<string, number> }) {
  if (!t) return null;
  const chips: string[] = [];
  if (t.watts !== undefined) chips.push(`${t.watts.toFixed(1)} W`);
  if (t.tempC !== undefined) chips.push(`${t.tempC.toFixed(1)}°C`);
  if (t.rssi !== undefined) chips.push(`${t.rssi > -60 ? '▂▄▆█' : t.rssi > -70 ? '▂▄▆' : '▂▄'} ${t.rssi}dBm`);
  return <div className="flex flex-wrap justify-end gap-1">{chips.map((c) => <span key={c} className="rounded-full bg-white/8 px-2 py-0.5 font-mono text-[10px] text-white/70">{c}</span>)}</div>;
}

/* ---------------- Account menu: notifications, install, PIN, sign out ---------------- */
export function AccountMenu({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const push = usePush(session.token);
  const install = useInstall();
  const ref = useRef<HTMLDivElement>(null);
  const u = session.user;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  async function savePin() {
    try { await api('/api/me/pin', { body: { pin }, token: session.token }); setMsg('PIN updated'); setPinMode(false); setPin(''); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Failed'); }
  }

  const pushLabel = {
    on: 'Notifications on', off: 'Turn on notifications', busy: 'Working…', denied: 'Notifications blocked in browser settings',
    unsupported: 'Notifications not supported here', insecure: 'Notifications need HTTPS or localhost',
  }[push.status];

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu"
              className="glass flex items-center gap-2 rounded-full py-1 pl-1 pr-3 transition-colors hover:bg-white/10">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10">{u.avatar}</span>
        <span className="text-left leading-tight">
          <span className="block text-sm">{u.name}</span>
          <span className="block text-[10px] uppercase tracking-wider text-white/45">{ROLE_LABEL[u.role]}</span>
        </span>
      </button>

      {open && (
        <div role="menu" className="fade-in absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-white/10 bg-[#0d0f1a]/95 p-2 shadow-2xl backdrop-blur-xl">
          {u.role === 'guest' && u.expiresAt && (
            <div className="mb-1 rounded-xl bg-white/5 px-3 py-2 text-xs text-white/60">🎟️ Guest pass · {timeLeft(u.expiresAt)}</div>
          )}
          <MenuItem onClick={() => (push.status === 'on' ? push.disable() : push.enable())}
                    disabled={['busy', 'denied', 'unsupported', 'insecure'].includes(push.status)}
                    icon={push.status === 'on' ? '🔔' : '🔕'} label={pushLabel}
                    hint={push.status === 'on' ? 'Tap to turn off' : u.role === 'guest' ? undefined : 'Door unlocked, devices offline…'} />
          {push.error && <p className="px-3 pb-1 text-[11px] text-amber-300">{push.error}</p>}
          {install.canInstall && <MenuItem onClick={install.install} icon="📲" label="Install IQHomes app" hint="Home screen, full screen, offline" />}
          {install.iosHint && <MenuItem icon="📲" label="Install on iPhone" hint="Tap Share, then “Add to Home Screen”" />}
          {u.role !== 'guest' && (
            pinMode ? (
              <div className="flex gap-2 px-2 py-1.5">
                <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" placeholder="New PIN (4–8 digits)"
                       className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm outline-none" autoFocus />
                <button onClick={savePin} className="rounded-lg bg-nova px-3 text-sm">Save</button>
              </div>
            ) : <MenuItem onClick={() => { setPinMode(true); setMsg(null); }} icon="🔑" label="Change my PIN" />
          )}
          {msg && <p className="px-3 pb-1 text-[11px] text-white/60">{msg}</p>}
          <div className="my-1 h-px bg-white/8" />
          <MenuItem onClick={onSignOut} icon="↩︎" label="Sign out" />
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, hint, onClick, disabled }: { icon: string; label: string; hint?: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button role="menuitem" onClick={onClick} disabled={disabled || !onClick}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors enabled:hover:bg-white/8 disabled:cursor-default disabled:opacity-60">
      <span className="w-5 text-center">{icon}</span>
      <span className="flex-1">
        <span className="block">{label}</span>
        {hint && <span className="block text-[11px] text-white/40">{hint}</span>}
      </span>
    </button>
  );
}

/* ---------------- Toasts (live alerts on every open screen) ---------------- */
export function Toasts({ items, dismiss }: { items: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {items.map((t) => (
        <button key={t.id} onClick={() => dismiss(t.id)}
                className={`toast-in pointer-events-auto w-full max-w-sm rounded-2xl border px-4 py-3 text-left shadow-2xl backdrop-blur-xl ${t.tone === 'warn' ? 'border-amber-300/25 bg-[#1a1408]/90' : 'border-white/10 bg-[#0d0f1a]/90'}`}>
          <div className="text-sm font-medium">{t.title}</div>
          {t.body && <div className="mt-0.5 text-xs text-white/60">{t.body}</div>}
        </button>
      ))}
    </div>
  );
}
