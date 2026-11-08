import { useEffect, useState } from 'react';
import type { Device, HomeState, Thermostat } from '../types';
import type { AssistantResult } from '../useHome';
import { useVoice } from '../useVoice';

/**
 * Wall display mode: a full-screen view for a tablet on the wall (like an Echo Show).
 * Big clock, weather, one-tap scenes and favourite devices, and the Nova orb. Keeps the screen awake.
 */
export function WallDisplay({ state, name, ask, lang, runScene, update, onExit }: {
  state: HomeState; name: string; lang: 'en' | 'fr';
  ask: (t: string) => Promise<AssistantResult>; runScene: (id: string) => void;
  update: (id: string, c: Partial<Device>) => void; onExit: () => void;
}) {
  const [now, setNow] = useState(new Date());
  const [said, setSaid] = useState<{ you?: string; nova?: string }>({});
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  // Keep the screen on and go full screen while the wall display is open.
  useEffect(() => {
    let lock: { release(): Promise<void> } | undefined;
    const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } };
    nav.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {});
    document.documentElement.requestFullscreen?.().catch(() => {});
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onExit(); };
    window.addEventListener('keydown', onKey);
    return () => {
      void lock?.release().catch(() => {});
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      window.removeEventListener('keydown', onKey);
    };
  }, [onExit]);

  const voice = useVoice(async (t) => {
    setSaid({ you: t });
    const r = await ask(t);
    setSaid({ you: t, nova: r.reply });
    return r.reply;
  }, lang);

  const w = state.weather;
  const t = state.devices.find((d): d is Thermostat => d.type === 'thermostat');
  const favourites = state.devices.filter((d) => (d.type === 'light' || d.type === 'plug' || d.type === 'fan' || d.type === 'tv' || d.type === 'lock' || d.type === 'garage')).slice(0, 8);
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const nextTimer = [...(state.timers ?? [])].sort((a, b) => a.at - b.at)[0];

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-[#05060b] text-white">
      <div className="aurora pointer-events-none fixed inset-0" />
      <div className="relative z-10 mx-auto grid min-h-full max-w-7xl gap-6 p-6 lg:grid-cols-[1.2fr_1fr] lg:p-10">
        {/* Left: clock, weather, Nova */}
        <div className="flex flex-col justify-between gap-8">
          <div>
            <div className="text-lg text-white/55">{greeting}, {name}</div>
            <div className="font-display text-[22vw] font-extralight leading-none tracking-tight tabular-nums sm:text-[9rem] lg:text-[11rem]">
              {now.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[ap]\.?m\.?/i, '')}
              <span className="ml-2 align-top text-3xl text-white/40">{now.getHours() < 12 ? 'AM' : 'PM'}</span>
            </div>
            <div className="mt-1 text-xl text-white/60">{now.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          </div>

          {w && (
            <div className="flex items-center gap-6">
              <span className="text-7xl">{w.icon}</span>
              <div>
                <div className="font-display text-6xl font-light">{w.temp}°</div>
                <div className="text-white/55">{w.condition} · H {w.high}° L {w.low}° · {w.place}</div>
              </div>
              <div className="ml-auto hidden gap-4 sm:flex">
                {w.hourly.slice(1, 6).map((h) => (
                  <div key={h.time} className="text-center text-sm">
                    <div className="text-white/40">{new Date(h.time).toLocaleTimeString('en-CA', { hour: 'numeric' })}</div>
                    <div className="text-2xl">{h.icon}</div><div>{h.temp}°</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-6">
            <button onClick={voice.pushToTalk} disabled={!voice.supported} aria-label="Talk to Nova" className="orb h-32 w-32 shrink-0" data-mode={voice.mode}>
              <span className="ring" /><span className="ring" /><span className="ring" /><span className="orb-glow" /><span className="orb-core" />
            </button>
            <div className="min-w-0 text-lg">
              <div className="text-white/45">{voice.mode === 'listening' ? (voice.interim || 'Listening…') : said.you ? `“${said.you}”` : 'Tap the orb and talk to Nova'}</div>
              {said.nova && <div className="mt-1 text-white/90">{said.nova}</div>}
              {nextTimer && <div className="mt-2 text-sm text-aqua">⏲️ {nextTimer.label} · {nextTimer.kind === 'timer' ? `${Math.max(0, Math.ceil((nextTimer.at - now.getTime()) / 60000))} min left` : new Date(nextTimer.at).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}</div>}
            </div>
          </div>
        </div>

        {/* Right: scenes, climate, favourites */}
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-3 gap-3">
            {state.scenes.map((s) => (
              <button key={s.id} onClick={() => runScene(s.id)} className="glass rounded-3xl py-5 text-center transition-transform active:scale-95">
                <div className="text-4xl">{s.icon}</div><div className="mt-1 text-sm">{s.name}</div>
              </button>
            ))}
          </div>

          {t && (
            <div className="glass flex items-center justify-between rounded-3xl p-5">
              <button onClick={() => update(t.id, { target: t.target - 1 })} className="h-16 w-16 rounded-full bg-white/10 text-3xl" aria-label="Cooler">−</button>
              <div className="text-center">
                <div className="font-display text-6xl font-light">{t.target}°</div>
                <div className="text-sm text-white/50">Inside {t.current}° · {t.mode}</div>
              </div>
              <button onClick={() => update(t.id, { target: t.target + 1 })} className="h-16 w-16 rounded-full bg-white/10 text-3xl" aria-label="Warmer">+</button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {favourites.map((d) => {
              const on = 'on' in d ? d.on : d.type === 'lock' ? !d.locked : d.type === 'garage' ? d.open : false;
              const icon = { light: '💡', plug: '🔌', fan: '🌀', tv: '📺', lock: on ? '🔓' : '🔒', garage: '🚗' }[d.type as 'light'] ?? '•';
              const toggle = () => {
                if ('on' in d) update(d.id, { on: !d.on });
                else if (d.type === 'lock') update(d.id, { locked: !d.locked });
                else if (d.type === 'garage' && d.open) update(d.id, { open: false }); // opening a garage needs the main app's confirm
              };
              return (
                <button key={d.id} onClick={toggle}
                        className={`flex items-center gap-3 rounded-3xl p-4 text-left transition-all active:scale-95 ${on ? 'bg-gradient-to-br from-nova/50 to-nova-2/40 shadow-lg' : 'glass'}`}
                        style={d.type === 'light' && d.on ? { boxShadow: `0 10px 40px -12px ${d.color}` } : undefined}>
                  <span className="text-3xl">{icon}</span>
                  <span className="min-w-0"><span className="block truncate text-base">{d.name}</span><span className="text-xs text-white/55">{on ? (d.type === 'lock' ? 'Unlocked' : d.type === 'garage' ? 'Open' : 'On') : d.type === 'lock' ? 'Locked' : d.type === 'garage' ? 'Closed' : 'Off'}</span></span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <button onClick={onExit} className="fixed right-4 top-4 z-20 rounded-full bg-white/10 px-4 py-2 text-sm backdrop-blur hover:bg-white/20">Exit wall mode</button>
    </div>
  );
}
