import type { ActivityEntry, Device, HomeState, Scene, Thermostat } from '../types';

/* ---------------- Climate dial ---------------- */
export function ClimateCard({ t, outside, update }: { t: Thermostat; outside: number; update: (id: string, c: Partial<Device>) => void }) {
  const pct = (t.target - 10) / 20;               // 10°–30° mapped onto the arc
  const r = 70, c = 2 * Math.PI * r, arc = c * 0.75;
  const heating = t.mode !== 'off' && t.target - t.current > 0.3;
  const cooling = t.mode !== 'off' && t.current - t.target > 0.3;
  const accent = heating ? '#ff9f43' : cooling ? '#4d8dff' : '#5ff0e0';

  return (
    <section className="glass rounded-3xl p-5">
      <header className="flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-white/60">Climate</h2>
        <span className="text-xs text-white/45">Outside {outside}°</span>
      </header>
      <div className="relative mx-auto mt-2 grid h-48 w-48 place-items-center">
        <svg viewBox="0 0 180 180" className="absolute inset-0 -rotate-[225deg]">
          <circle cx="90" cy="90" r={r} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${arc} ${c}`} />
          <circle cx="90" cy="90" r={r} fill="none" stroke={accent} strokeWidth="12" strokeLinecap="round"
                  strokeDasharray={`${arc * pct} ${c}`} style={{ transition: 'stroke-dasharray .6s, stroke .6s', filter: `drop-shadow(0 0 8px ${accent})` }} />
        </svg>
        <div className="text-center">
          <div className="font-display text-5xl font-light tabular-nums">{t.target}°</div>
          <div className="mt-1 text-xs text-white/50">Inside now {t.current}°</div>
          <div className="mt-1 text-[11px] font-medium" style={{ color: accent }}>
            {t.mode === 'off' ? 'Off' : heating ? 'Heating…' : cooling ? 'Cooling…' : 'Holding'}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-center gap-3">
        <button aria-label="Cooler" onClick={() => update(t.id, { target: t.target - 1 })} className="h-10 w-10 rounded-full bg-white/8 text-xl hover:bg-white/15">−</button>
        <div className="flex rounded-full bg-white/5 p-1 text-xs">
          {(['heat', 'auto', 'cool', 'off'] as const).map((m) => (
            <button key={m} onClick={() => update(t.id, { mode: m })}
                    className={`rounded-full px-2.5 py-1 capitalize transition-colors ${t.mode === m ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white'}`}>{m}</button>
          ))}
        </div>
        <button aria-label="Warmer" onClick={() => update(t.id, { target: t.target + 1 })} className="h-10 w-10 rounded-full bg-white/8 text-xl hover:bg-white/15">+</button>
      </div>
    </section>
  );
}

/* ---------------- Live energy chart ---------------- */
export function EnergyCard({ state }: { state: HomeState }) {
  const pts = state.energy.length ? state.energy : [{ time: Date.now(), watts: 0 }];
  const now = pts[pts.length - 1].watts;
  const max = Math.max(...pts.map((p) => p.watts), 200);
  const w = 300, h = 80;
  const path = pts.map((p, i) => `${(i / Math.max(pts.length - 1, 1)) * w},${h - (p.watts / max) * (h - 6)}`).join(' L ');
  const top = [...state.devices].sort((a, b) => b.watts - a.watts).slice(0, 3);
  const perHour = ((now / 1000) * 0.13).toFixed(2);
  const perMonth = ((now / 1000) * 0.13 * 24 * 30).toFixed(0);

  return (
    <section className="glass rounded-3xl p-5">
      <header className="flex items-baseline justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-white/60">Energy</h2>
        <span className="flex items-center gap-1.5 text-[11px] text-emerald-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />Live</span>
      </header>
      <div className="mt-2 flex items-end gap-2">
        <span className="font-display text-4xl font-light tabular-nums">{now.toLocaleString()}</span>
        <span className="mb-1 text-sm text-white/50">watts</span>
      </div>
      <div className="text-xs text-white/45">≈ ${perHour}/hour · ${perMonth}/month at this rate</div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-3 h-20 w-full" role="img" aria-label="Power use over the last few minutes">
        <defs>
          <linearGradient id="eg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#6f8cff" stopOpacity=".45" /><stop offset="1" stopColor="#6f8cff" stopOpacity="0" /></linearGradient>
        </defs>
        <path d={`M 0,${h} L ${path} L ${w},${h} Z`} fill="url(#eg)" />
        <path d={`M ${path}`} fill="none" stroke="#8fa6ff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <ul className="mt-3 space-y-1.5 text-sm">
        {top.map((d) => (
          <li key={d.id} className="flex items-center gap-2">
            <span className="flex-1 truncate text-white/70">{d.name}</span>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/8">
              <div className="h-full rounded-full bg-gradient-to-r from-nova to-nova-2 transition-all duration-700" style={{ width: `${Math.max(3, (d.watts / Math.max(now, 1)) * 100)}%` }} />
            </div>
            <span className="w-14 text-right tabular-nums text-white/50">{d.watts} W</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------- Activity feed ---------------- */
const SOURCE_LABEL: Record<ActivityEntry['source'], string> = { app: 'App', voice: 'Voice', scene: 'Scene', system: 'System', hardware: 'Hardware' };

export function ActivityFeed({ items }: { items: ActivityEntry[] }) {
  return (
    <section className="glass rounded-3xl p-5">
      <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-white/60">Activity</h2>
      <ul className="mt-3 max-h-72 space-y-3 overflow-y-auto pr-1">
        {items.length === 0 && <li className="text-xs text-white/40">Nothing yet.</li>}
        {items.slice(0, 25).map((a) => (
          <li key={a.id} className="fade-in flex gap-3 text-sm">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.source === 'voice' ? 'bg-nova-2' : a.source === 'scene' ? 'bg-aqua' : a.source === 'system' ? 'bg-white/30' : a.source === 'hardware' ? 'bg-emerald-400' : 'bg-nova'}`} />
            <div className="min-w-0">
              <div className="truncate text-white/85">{a.text}</div>
              <div className="text-[11px] text-white/35">{SOURCE_LABEL[a.source]}{a.by ? ` · ${a.by}` : ''} · {new Date(a.time).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------- Scenes ---------------- */
export function ScenesBar({ scenes, run }: { scenes: Scene[]; run: (id: string) => void }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {scenes.map((s) => (
        <button key={s.id} onClick={() => run(s.id)} title={s.description}
                className="glass group flex min-w-40 shrink-0 items-center gap-3 rounded-2xl px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-white/20 active:scale-95">
          <span className="text-2xl transition-transform group-hover:scale-110">{s.icon}</span>
          <span>
            <span className="block text-sm font-medium">{s.name}</span>
            <span className="block text-[11px] text-white/40">{s.description}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
