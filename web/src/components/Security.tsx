import { useEffect, useState } from 'react';
import type { HomeState, Sensor, SecurityMode } from '../types';

const SENSOR_ICON: Record<Sensor['kind'], string> = { motion: '🏃', contact: '🚪', smoke: '🔥', co: '☁️', leak: '💧' };
const SENSOR_WORDS: Record<Sensor['kind'], [string, string]> = {
  motion: ['Clear', 'Motion'], contact: ['Closed', 'Open'], smoke: ['All clear', 'SMOKE'], co: ['All clear', 'CO DETECTED'], leak: ['Dry', 'LEAK'],
};

export interface SecurityActions {
  setMode: (m: SecurityMode) => void;
  silence: () => void;
  simulate: (id: string, triggered: boolean) => void;
  setPresence: (on: boolean) => void;
}

export function SecurityPanel({ state, actions, isOwner }: { state: HomeState; actions: SecurityActions; isOwner: boolean }) {
  const sec = state.security;
  const sensors = state.devices.filter((d): d is Sensor => d.type === 'sensor');
  if (!sec) return null;
  const roomName = (id: string) => state.rooms.find((r) => r.id === id)?.name ?? id;
  const modes: [SecurityMode, string, string][] = [['disarmed', '🔓', 'Off'], ['home', '🏠', 'Home'], ['away', '🛡️', 'Away']];

  return (
    <section className="glass rounded-3xl p-5">
      <header className="flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-white/60">Security</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${sec.mode === 'disarmed' ? 'bg-white/8 text-white/55' : 'bg-emerald-400/15 text-emerald-300'}`}>
          {sec.mode === 'disarmed' ? 'Disarmed' : `Armed · ${sec.mode === 'away' ? 'Away' : 'Home'}`}
        </span>
      </header>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {modes.map(([m, icon, label]) => (
          <button key={m} onClick={() => actions.setMode(m)}
                  className={`rounded-2xl py-3 text-sm transition-all ${sec.mode === m ? (m === 'disarmed' ? 'bg-white/15' : 'bg-gradient-to-br from-emerald-400/40 to-aqua/30 ring-1 ring-emerald-300/40') : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>
            <div className="text-lg">{icon}</div>{label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-white/40">
        {sec.mode === 'away' ? 'Any motion or open door/window sets off the alarm.' : sec.mode === 'home' ? 'Doors and windows are watched; motion inside is ignored.' : 'Only smoke, CO and leak sensors will alert.'}
      </p>

      <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-2xl bg-white/4 px-3 py-2 text-xs">
        <span><b className="font-medium text-white/80">🎭 Presence simulation</b><br /><span className="text-white/45">While away, lights turn on and off in the evening so it looks like someone's home.</span></span>
        <input type="checkbox" checked={sec.presenceSim} onChange={(e) => actions.setPresence(e.target.checked)} className="h-4 w-4 accent-[#6f8cff]" />
      </label>

      <Cameras state={state} />

      <ul className="mt-4 space-y-1.5">
        {sensors.map((s) => {
          const danger = s.triggered && (s.kind === 'smoke' || s.kind === 'co' || s.kind === 'leak');
          return (
            <li key={s.id} className={`flex items-center gap-3 rounded-2xl px-3 py-2 ${danger ? 'bg-red-500/20 ring-1 ring-red-400/50' : s.triggered ? 'bg-amber-400/10' : 'bg-white/4'}`}>
              <span className="text-lg">{SENSOR_ICON[s.kind]}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{s.name}</div>
                <div className="text-[11px] text-white/45">{roomName(s.room)} · 🔋 {s.battery}%</div>
              </div>
              <span className={`text-[11px] font-semibold ${danger ? 'text-red-300' : s.triggered ? 'text-amber-300' : 'text-white/45'}`}>{SENSOR_WORDS[s.kind][s.triggered ? 1 : 0]}</span>
              {isOwner && (
                <button onClick={() => actions.simulate(s.id, !s.triggered)} title="Demo: trigger or clear this sensor"
                        className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-white/60 hover:bg-white/15">{s.triggered ? 'Clear' : 'Simulate'}</button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Two simulated camera feeds: film grain, live timestamp, and a motion box when a sensor in that room fires. */
function Cameras({ state }: { state: HomeState }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const cams = [
    { room: 'entrance', name: 'Front Porch', bg: 'linear-gradient(160deg,#1c2a3a 0%,#2b3d2f 55%,#3d3a2c 100%)' },
    { room: 'living', name: 'Living Room', bg: 'linear-gradient(160deg,#2d2533 0%,#3a2f2a 60%,#1f2430 100%)' },
  ];
  return (
    <div className="mt-4 grid grid-cols-2 gap-2">
      {cams.map((c) => {
        const motion = state.devices.some((d) => d.type === 'sensor' && d.room === c.room && d.kind === 'motion' && d.triggered);
        const lit = state.devices.some((d) => d.type === 'light' && d.room === c.room && d.on);
        return (
          <div key={c.name} className="cam relative aspect-video overflow-hidden rounded-2xl" style={{ background: c.bg, filter: lit ? 'brightness(1.25) saturate(1.1)' : 'brightness(.7) saturate(.6)' }}>
            <div className="cam-grain absolute inset-0" />
            <div className="absolute bottom-[18%] left-[30%] h-[38%] w-[40%] rounded-t-lg bg-black/25" />
            {motion && (
              <div className="absolute left-[38%] top-[28%] h-[52%] w-[22%] animate-pulse border-2 border-red-400">
                <span className="absolute -top-4 left-0 bg-red-500 px-1 text-[8px] font-bold text-white">PERSON</span>
              </div>
            )}
            <div className="absolute left-2 top-1.5 flex items-center gap-1 text-[9px] font-semibold text-white/85">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />REC · {c.name}
            </div>
            <div className="absolute bottom-1.5 right-2 font-mono text-[9px] text-white/70">{new Date(now).toLocaleTimeString('en-CA')}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Full-screen flashing alert while an alarm is going off, on every screen. */
export function AlarmOverlay({ state, silence }: { state: HomeState; silence: () => void }) {
  const a = state.security?.alarm;
  if (!a) return null;
  const room = state.rooms.find((r) => r.id === a.room)?.name ?? a.room;
  const sensor = state.devices.find((d) => d.id === a.sensorId);
  const title = { intruder: 'INTRUDER ALERT', smoke: 'SMOKE DETECTED', co: 'CARBON MONOXIDE', leak: 'WATER LEAK' }[a.kind];
  const icon = { intruder: '🚨', smoke: '🔥', co: '☁️', leak: '💧' }[a.kind];
  const advice = {
    intruder: 'Every light has been turned on. Check your cameras, and call 911 if you are in danger.',
    smoke: 'Lights on, blinds open, heating off. Get everyone outside and call 911.',
    co: 'Get everyone outside into fresh air right away and call 911.',
    leak: 'Turn off the water supply and check under the sink.',
  }[a.kind];
  return (
    <div role="alertdialog" aria-label={title} className={`fixed inset-0 z-[80] grid place-items-center p-6 ${a.kind === 'leak' ? 'alarm-flash-blue' : 'alarm-flash'}`}>
      <div className="w-full max-w-lg rounded-[2rem] border border-white/20 bg-black/70 p-8 text-center shadow-2xl backdrop-blur-xl">
        <div className="text-7xl">{icon}</div>
        <h2 className="mt-4 font-display text-3xl font-bold tracking-wide sm:text-4xl">{title}</h2>
        <p className="mt-2 text-lg text-white/85">{sensor?.name ?? 'Sensor'} · {room}</p>
        <p className="mt-4 text-sm leading-relaxed text-white/70">{advice}</p>
        <p className="mt-2 text-xs text-white/45">Since {new Date(a.since).toLocaleTimeString('en-CA')}</p>
        <button onClick={silence} className="mt-6 w-full rounded-full bg-white py-3.5 text-base font-semibold text-black hover:bg-white/90">
          🔕 Silence {a.kind === 'intruder' ? '& disarm' : 'alarm'}
        </button>
      </div>
    </div>
  );
}
