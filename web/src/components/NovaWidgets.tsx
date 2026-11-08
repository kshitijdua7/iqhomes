import { useEffect, useState } from 'react';
import type { Routine, TimerItem, WeatherInfo } from '../types';
import type { Announcement } from '../useHome';

const fmtClock = (ms: number) => new Date(ms).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}

/* ---------------- Weather ---------------- */
export function WeatherCard({ w, compact }: { w?: WeatherInfo; compact?: boolean }) {
  if (!w) return null;
  const now = Date.now();
  const sunNext = now < w.sunrise ? `Sunrise ${fmtClock(w.sunrise)}` : now < w.sunset ? `Sunset ${fmtClock(w.sunset)}` : `Sunrise ${fmtClock(w.sunrise + 86_400_000)}`;
  return (
    <section className="glass rounded-3xl p-5">
      <header className="flex items-baseline justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-white/60">{w.place}</h2>
        <span className="text-[11px] text-white/40">{sunNext}</span>
      </header>
      <div className="mt-3 flex items-center gap-4">
        <span className="text-5xl" aria-hidden>{w.icon}</span>
        <div>
          <div className="font-display text-4xl font-light tabular-nums">{w.temp}°</div>
          <div className="text-xs text-white/55">{w.condition} · feels {w.feelsLike}°</div>
        </div>
        <div className="ml-auto text-right text-xs text-white/55">
          <div>H {w.high}° · L {w.low}°</div>
          <div>💧 {w.rainChance}% · 💨 {w.wind} km/h</div>
        </div>
      </div>
      {!compact && (
        <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
          {w.hourly.slice(0, 8).map((h) => (
            <div key={h.time} className="flex shrink-0 flex-col items-center gap-1 rounded-2xl bg-white/4 px-2.5 py-2 text-[11px]">
              <span className="text-white/45">{new Date(h.time).toLocaleTimeString('en-CA', { hour: 'numeric' })}</span>
              <span className="text-base">{h.icon}</span>
              <span className="tabular-nums">{h.temp}°</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------------- Timers, alarms, reminders ---------------- */
const KIND_ICON = { timer: '⏲️', alarm: '⏰', reminder: '🔔' } as const;

export function TimersCard({ timers, cancel }: { timers: TimerItem[]; cancel: (id: string) => void }) {
  const now = useNow();
  if (!timers.length) return null;
  const sorted = [...timers].sort((a, b) => a.at - b.at);
  return (
    <section className="glass rounded-3xl p-5">
      <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-white/60">Timers & reminders</h2>
      <ul className="mt-3 space-y-2">
        {sorted.map((t) => {
          const left = Math.max(0, t.at - now);
          const pct = t.duration ? 1 - left / t.duration : 0;
          const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000), hh = Math.floor(mm / 60);
          return (
            <li key={t.id} className="flex items-center gap-3 rounded-2xl bg-white/4 px-3 py-2">
              {t.kind === 'timer' ? (
                <svg viewBox="0 0 36 36" className="h-9 w-9 shrink-0 -rotate-90" aria-hidden>
                  <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="4" />
                  <circle cx="18" cy="18" r="15" fill="none" stroke="url(#tg)" strokeWidth="4" strokeLinecap="round"
                          strokeDasharray={`${pct * 94.2} 94.2`} style={{ transition: 'stroke-dasharray 1s linear' }} />
                  <defs><linearGradient id="tg"><stop offset="0" stopColor="#5ff0e0" /><stop offset="1" stopColor="#a26bff" /></linearGradient></defs>
                </svg>
              ) : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/8">{KIND_ICON[t.kind]}</span>}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm capitalize">{t.kind === 'reminder' ? t.label : t.label}</div>
                <div className="text-[11px] text-white/45">
                  {t.kind === 'timer' ? `${hh ? `${hh}:${String(mm % 60).padStart(2, '0')}` : mm}:${String(ss).padStart(2, '0')} left` : `${t.kind === 'alarm' ? 'Alarm' : 'Reminder'} · ${fmtClock(t.at)}`}
                  {t.createdBy ? ` · ${t.createdBy}` : ''}
                </div>
              </div>
              <button onClick={() => cancel(t.id)} aria-label={`Cancel ${t.label}`} className="rounded-full px-2 py-1 text-[11px] text-white/40 hover:bg-white/10 hover:text-white">✕</button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------------- Custom routines (shown next to scenes) ---------------- */
export function RoutineChips({ routines, run }: { routines: Routine[]; run: (phrase: string) => void }) {
  if (!routines.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {routines.map((r) => (
        <button key={r.id} onClick={() => run(r.phrase)} title={`Runs: ${r.actions}`}
                className="glass rounded-full px-3.5 py-1.5 text-xs text-white/80 transition-colors hover:bg-white/10">
          ✨ “{r.phrase}”
        </button>
      ))}
    </div>
  );
}

/* ---------------- Announcements: chime + spoken + full-width banner on every screen ---------------- */
function chime(ring = false) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const notes = ring ? [880, 660, 880, 660, 880, 660] : [659, 784, 988];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t = ctx.currentTime + i * (ring ? 0.22 : 0.16);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.55);
    });
    setTimeout(() => void ctx.close(), 3000);
  } catch { /* audio blocked until the page is tapped once */ }
}

export function AnnouncementBanner({ a, dismiss, lang }: { a: Announcement | null; dismiss: () => void; lang: 'en' | 'fr' }) {
  useEffect(() => {
    if (!a) return;
    chime(a.ring);
    const speakIt = setTimeout(() => {
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(a.from && !a.ring ? `${a.from} says: ${a.text}` : a.text);
      u.lang = lang === 'fr' ? 'fr-CA' : 'en-CA';
      window.speechSynthesis.speak(u);
    }, a.ring ? 1400 : 600);
    const close = setTimeout(dismiss, 12_000);
    return () => { clearTimeout(speakIt); clearTimeout(close); };
  }, [a, dismiss, lang]);

  if (!a) return null;
  return (
    <div role="alert" className="toast-in fixed inset-x-0 top-0 z-[70] flex justify-center px-4 pt-4">
      <button onClick={dismiss} className="w-full max-w-xl rounded-3xl border border-nova/40 bg-[#0d0f1a]/95 px-6 py-5 text-left shadow-[0_20px_80px_-20px] shadow-nova backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <span className="text-4xl">{a.kind === 'timer' ? '⏲️' : a.kind === 'alarm' ? '⏰' : a.kind === 'reminder' ? '🔔' : '📢'}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-widest text-white/45">{a.kind ? a.kind : `Announcement${a.from ? ` from ${a.from}` : ''}`}</div>
            <div className="mt-0.5 font-display text-xl font-semibold leading-snug">{a.text}</div>
          </div>
          <span className="text-xs text-white/40">Tap to dismiss</span>
        </div>
      </button>
    </div>
  );
}
