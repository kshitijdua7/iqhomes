import type { Device } from '../types';
import { Telemetry } from './Access';

type Update = (id: string, changes: Partial<Device>) => void;

const ICONS: Record<Device['type'], string> = {
  light: '💡', blinds: '🪟', thermostat: '🌡️', lock: '🔒', fan: '🌀', plug: '🔌', tv: '📺',
};

const SWATCHES = ['#ffd9a0', '#ffffff', '#e6f0ff', '#ff4d4d', '#4cd97b', '#4d8dff', '#9b6bff', '#ff6fb5'];

function isActive(d: Device) {
  switch (d.type) {
    case 'light': case 'fan': case 'plug': case 'tv': return d.on;
    case 'blinds': return d.position > 0;
    case 'lock': return !d.locked;
    case 'thermostat': return d.mode !== 'off';
  }
}

function status(d: Device) {
  switch (d.type) {
    case 'light': return d.on ? (d.dimmable === false ? 'On' : `${d.brightness}%`) : 'Off';
    case 'blinds': return d.position === 0 ? 'Closed' : d.position === 100 ? 'Open' : `${d.position}% open`;
    case 'lock': return d.locked ? 'Locked' : 'Unlocked';
    case 'fan': return d.on ? `Speed ${d.speed}` : 'Off';
    case 'tv': return d.on ? `Vol ${d.volume}` : 'Off';
    case 'plug': return d.on ? 'On' : 'Off';
    case 'thermostat': return `${d.current}° → ${d.target}°`;
  }
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      role="switch" aria-checked={on} aria-label={label} onClick={onChange}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? 'bg-nova' : 'bg-white/10'}`}
    >
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-1'}`} />
    </button>
  );
}

export function DeviceCard({ device: d, update, roomName }: { device: Device; update: Update; roomName?: string }) {
  const active = isActive(d);
  const glow = d.type === 'light' && d.on ? d.color : undefined;

  return (
    <div
      className={`glass fade-in relative overflow-hidden rounded-3xl p-4 transition-all duration-300 ${active ? 'border-white/15' : ''}`}
      style={glow ? { boxShadow: `0 0 0 1px ${glow}33, 0 18px 50px -20px ${glow}`, } : undefined}
    >
      {glow && (
        <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full blur-2xl transition-opacity"
             style={{ background: glow, opacity: (d.type === 'light' ? d.brightness : 0) / 260 }} />
      )}
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`grid h-11 w-11 place-items-center rounded-2xl text-xl transition-colors ${active ? 'bg-white/15' : 'bg-white/5 grayscale'}`}>
            {d.type === 'lock' && !d.locked ? '🔓' : ICONS[d.type]}
          </div>
          <div>
            <div className="font-medium leading-tight">{d.name}</div>
            <div className="text-xs text-white/45">{roomName ? `${roomName} · ` : ''}{status(d)}</div>
            {d.hardware && (
              <div className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${d.hardware.online ? 'bg-emerald-400/15 text-emerald-300' : 'bg-red-400/10 text-red-300'}`}
                   title={d.hardware.online ? 'This is a real physical device' : 'The physical device is not connected'}>
                <span className={`h-1.5 w-1.5 rounded-full ${d.hardware.online ? 'animate-pulse bg-emerald-300' : 'bg-red-300'}`} />
                {d.hardware.online ? 'Real' : 'Offline'} · {d.hardware.kind}
              </div>
            )}
          </div>
        </div>
        {'on' in d && <Toggle on={d.on} label={`Toggle ${d.name}`} onChange={() => update(d.id, { on: !d.on })} />}
        {d.type === 'lock' && <Toggle on={d.locked} label={`Lock ${d.name}`} onChange={() => update(d.id, { locked: !d.locked })} />}
      </div>

      {d.hardware?.online && d.hardware.telemetry && <div className="relative mt-3"><Telemetry t={d.hardware.telemetry} /></div>}

      <div className="relative mt-4 space-y-3">
        {d.type === 'light' && d.dimmable !== false && (
          <>
            <input type="range" min={1} max={100} value={d.brightness} aria-label="Brightness" className="w-full"
                   onChange={(e) => update(d.id, { brightness: Number(e.target.value), on: true })} />
            <div className="flex gap-1.5">
              {SWATCHES.map((c) => (
                <button key={c} aria-label={`Colour ${c}`} onClick={() => update(d.id, { color: c, on: true })}
                        className={`h-5 w-5 rounded-full border transition-transform hover:scale-110 ${d.color === c ? 'border-white scale-110' : 'border-white/20'}`}
                        style={{ background: c }} />
              ))}
            </div>
          </>
        )}

        {d.type === 'blinds' && (
          <>
            <div className="relative h-16 overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-sky-300/40 to-amber-200/20">
              <div className="absolute inset-x-0 top-0 transition-all duration-700"
                   style={{ height: `${100 - d.position}%`, background: 'repeating-linear-gradient(180deg, rgba(220,225,240,.85) 0 5px, rgba(160,170,190,.85) 5px 7px)' }} />
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => update(d.id, { position: 0 })} className="rounded-full bg-white/8 px-3 py-1 text-xs hover:bg-white/15">Close</button>
              <input type="range" min={0} max={100} step={5} value={d.position} aria-label="Blinds position" className="flex-1"
                     onChange={(e) => update(d.id, { position: Number(e.target.value) })} />
              <button onClick={() => update(d.id, { position: 100 })} className="rounded-full bg-white/8 px-3 py-1 text-xs hover:bg-white/15">Open</button>
            </div>
          </>
        )}

        {d.type === 'fan' && (
          <div className="flex items-center gap-2">
            <span className={`text-2xl ${d.on ? 'animate-spin' : ''}`} style={{ animationDuration: `${1.6 / d.speed}s` }}>🌀</span>
            {[1, 2, 3].map((s) => (
              <button key={s} onClick={() => update(d.id, { speed: s, on: true })}
                      className={`flex-1 rounded-xl py-1.5 text-sm transition-colors ${d.on && d.speed === s ? 'bg-nova text-white' : 'bg-white/6 hover:bg-white/12'}`}>
                {s}
              </button>
            ))}
          </div>
        )}

        {d.type === 'tv' && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/50">🔈</span>
            <input type="range" min={0} max={100} value={d.volume} aria-label="Volume" className="flex-1"
                   onChange={(e) => update(d.id, { volume: Number(e.target.value), on: true })} />
            <span className="w-7 text-right text-xs text-white/60">{d.volume}</span>
          </div>
        )}

        {d.type === 'lock' && (
          <div className="flex items-center justify-between text-xs text-white/50">
            <span className={d.locked ? 'text-emerald-300' : 'text-amber-300'}>{d.locked ? '● Secured' : '● Unlocked'}</span>
            <span>Battery {d.battery}%</span>
          </div>
        )}

        <div className="text-[11px] text-white/35">{d.watts} W</div>
      </div>
    </div>
  );
}
