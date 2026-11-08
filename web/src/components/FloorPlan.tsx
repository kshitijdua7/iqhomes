import { useState } from 'react';
import type { Device, HomeState } from '../types';

/**
 * A tilted 3D model of the house. Each room's floor glows with the colour and brightness of its lights,
 * blinds slide on the windows, doors show lock state, and triggered sensors pulse red. Click a room to filter.
 */
export function FloorPlan({ state, selected, onSelect }: { state: HomeState; selected: string; onSelect: (room: string) => void }) {
  const [tilt, setTilt] = useState(true);
  const rooms = state.rooms;

  return (
    <section className="glass relative overflow-hidden rounded-3xl p-5">
      <header className="relative z-10 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-white/60">Your home</h2>
        <div className="flex gap-1.5">
          {selected !== 'all' && <button onClick={() => onSelect('all')} className="rounded-full bg-white/8 px-3 py-1 text-xs hover:bg-white/15">Show all</button>}
          <button onClick={() => setTilt(!tilt)} className="rounded-full bg-white/8 px-3 py-1 text-xs hover:bg-white/15">{tilt ? '2D' : '3D'}</button>
        </div>
      </header>

      <div className="floor-stage mt-2" style={{ perspective: '1100px' }}>
        <div className={`floor-plane grid grid-cols-3 gap-2 ${tilt ? 'tilted' : ''}`}>
          {rooms.map((r, i) => (
            <Room key={r.id} name={r.name} icon={r.icon} devices={state.devices.filter((d) => d.room === r.id)}
                  big={i === 0} active={selected === r.id} dim={selected !== 'all' && selected !== r.id} onClick={() => onSelect(selected === r.id ? 'all' : r.id)} />
          ))}
        </div>
      </div>
      <p className="relative z-10 mt-1 text-center text-[11px] text-white/35">Tap a room to see its devices. Lights glow in their real colour.</p>
    </section>
  );
}

function Room({ name, icon, devices, big, active, dim, onClick }: { name: string; icon: string; devices: Device[]; big: boolean; active: boolean; dim: boolean; onClick: () => void }) {
  const lights = devices.filter((d): d is Extract<Device, { type: 'light' }> => d.type === 'light' && d.on);
  const glow = lights.length ? lights.reduce((best, l) => (l.brightness > best.brightness ? l : best)) : undefined;
  const level = lights.length ? Math.min(1, lights.reduce((s, l) => s + l.brightness, 0) / 120) : 0;
  const blinds = devices.find((d): d is Extract<Device, { type: 'blinds' }> => d.type === 'blinds');
  const alarm = devices.some((d) => d.type === 'sensor' && d.triggered);
  const unlocked = devices.some((d) => (d.type === 'lock' && !d.locked) || (d.type === 'garage' && d.open));
  const tvOn = devices.some((d) => d.type === 'tv' && d.on);
  const fanOn = devices.some((d) => d.type === 'fan' && d.on);

  return (
    <button onClick={onClick} aria-pressed={active} aria-label={`${name}: ${lights.length} light${lights.length === 1 ? '' : 's'} on`}
            className={`room-3d relative min-h-24 rounded-xl text-left transition-all duration-500 ${big ? 'col-span-2' : ''} ${active ? 'room-active' : ''} ${dim ? 'opacity-40' : ''}`}
            style={{
              background: glow
                ? `radial-gradient(circle at 50% 45%, ${glow.color}${Math.round(40 + level * 150).toString(16).padStart(2, '0')}, ${glow.color}14 70%), #0e1120`
                : 'linear-gradient(160deg,#161a2b,#0d0f1a)',
              boxShadow: glow ? `0 0 ${20 + level * 40}px -6px ${glow.color}, inset 0 0 0 1px rgba(255,255,255,.12)` : 'inset 0 0 0 1px rgba(255,255,255,.08)',
            }}>
      {/* walls */}
      <span className="wall wall-n" /><span className="wall wall-w" />
      {/* window + blinds on the top edge */}
      {blinds && (
        <span className="absolute left-1/4 top-0 h-1.5 w-1/2 overflow-hidden rounded-b bg-sky-300/50" title={`Blinds ${blinds.position}% open`}>
          <span className="absolute inset-x-0 top-0 bg-white/80 transition-all duration-700" style={{ height: `${100 - blinds.position}%` }} />
        </span>
      )}
      <div className="relative z-10 p-2.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-white/90">
          <span>{icon}</span><span className="truncate">{name}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
          {lights.length > 0 && <span title="Lights on">💡{lights.length > 1 ? lights.length : ''}</span>}
          {tvOn && <span title="TV on">📺</span>}
          {fanOn && <span className="inline-block animate-spin [animation-duration:1.5s]" title="Fan on">🌀</span>}
          {unlocked && <span title="Open or unlocked">🔓</span>}
        </div>
      </div>
      {alarm && <span className="absolute inset-0 animate-pulse rounded-xl ring-2 ring-red-500" style={{ background: 'rgba(255,40,60,.18)' }} />}
    </button>
  );
}
