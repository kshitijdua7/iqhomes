import { useEffect, useMemo, useState } from 'react';
import { useHome } from './useHome';
import { Assistant } from './components/Assistant';
import { Login } from './components/Login';
import { AccountMenu, HardwarePanel, PeoplePanel, Toasts } from './components/Access';
import { api, loadSession, saveSession, timeLeft, type Session } from './session';
import { DeviceCard } from './components/DeviceCard';
import { ActivityFeed, ClimateCard, EnergyCard, ScenesBar } from './components/Widgets';
import type { Thermostat } from './types';
import { BeamsBackground } from '@/components/ui/beams-background';

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);
  return now;
}

function greeting(h: number) { return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);

  const signIn = (s: Session) => { saveSession(s); setSession(s); };
  const signOut = () => {
    if (session) void api('/api/logout', { body: {}, token: session.token }).catch(() => {});
    saveSession(null);
    setSession(null);
  };

  if (!session) return <BeamsBackground intensity="medium"><Login onSignedIn={signIn} /></BeamsBackground>;
  return <Dashboard key={session.token} session={session} onSignOut={signOut} />;
}

function Dashboard({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const { state, connected, update, runScene, ask, toasts, dismiss } = useHome(session.token, onSignOut);
  const user = session.user;
  const [lockPrompt, setLockPrompt] = useState<string | null>(() => new URLSearchParams(location.search).get('lock'));
  const [room, setRoom] = useState('all');
  const now = useClock();

  const devices = useMemo(
    () => (state?.devices ?? []).filter((d) => d.type !== 'thermostat' && (room === 'all' || d.room === room)),
    [state, room],
  );

  if (!state) {
    return (
      <BeamsBackground intensity="medium">
        <div className="grid min-h-screen place-items-center">
          <div className="text-center">
            <div className="orb mx-auto h-24 w-24" data-mode="thinking"><span className="orb-glow" /><span className="orb-core" /></div>
            <p className="mt-6 text-sm text-white/60">Connecting to your home…</p>
            <p className="mt-1 text-xs text-white/35">Make sure the server is running (npm run dev in /server).</p>
          </div>
        </div>
      </BeamsBackground>
    );
  }

  const thermostat = state.devices.find((d): d is Thermostat => d.type === 'thermostat');
  const lockTarget = lockPrompt ? state.devices.find((d) => d.id === lockPrompt && d.type === 'lock') : undefined;
  const closeLockPrompt = () => { setLockPrompt(null); history.replaceState(null, '', '/'); };
  const lightsOn = state.devices.filter((d) => d.type === 'light' && d.on).length;
  const unlocked = state.devices.filter((d) => d.type === 'lock' && !d.locked).length;
  const roomName = (id: string) => state.rooms.find((r) => r.id === id)?.name;

  return (
    <BeamsBackground intensity="medium">
      <div className="relative z-10 mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="orb h-9 w-9" data-mode="idle"><span className="orb-core" /></div>
            <div>
              <div className="font-display text-lg font-semibold tracking-tight">IQHomes</div>
              <div className="flex items-center gap-1.5 text-[11px] text-white/45">
                <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'}`} />
                {connected ? 'Connected · live' : 'Reconnecting…'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
          <div className="hidden text-right sm:block">
            <div className="font-display text-2xl font-light tabular-nums">{now.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}</div>
            <div className="text-[11px] text-white/45">{now.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          </div>
          <AccountMenu session={session} onSignOut={onSignOut} />
          </div>
        </header>

        {lockTarget && lockTarget.type === 'lock' && (
          <div className="fade-in glass mt-6 flex flex-wrap items-center gap-3 rounded-2xl border-amber-300/30 px-4 py-3">
            <span className="text-xl">{lockTarget.locked ? '🔒' : '🔓'}</span>
            <span className="flex-1 text-sm">{lockTarget.locked ? `${lockTarget.name} is locked.` : `${lockTarget.name} is unlocked. Lock it now?`}</span>
            {!lockTarget.locked && (
              <button onClick={() => { update(lockTarget.id, { locked: true }); closeLockPrompt(); }}
                      className="rounded-full bg-gradient-to-r from-nova to-nova-2 px-4 py-1.5 text-sm font-medium">Lock now</button>
            )}
            <button onClick={closeLockPrompt} className="rounded-full px-3 py-1.5 text-sm text-white/60 hover:bg-white/10">Dismiss</button>
          </div>
        )}

        {user.role === 'guest' && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm text-white/70">
            🎟️ Welcome! Your guest pass covers <b className="text-white">{state.rooms.map((r) => r.name).join(', ')}</b>
            {user.expiresAt ? <> · {timeLeft(user.expiresAt)}</> : null}.
          </div>
        )}

        <h1 className="mt-8 font-display text-3xl font-light tracking-tight sm:text-4xl">
          {greeting(now.getHours())}, <span className="bg-gradient-to-r from-aqua via-nova to-nova-2 bg-clip-text font-semibold text-transparent">{user.role === 'family' ? 'family' : user.name}</span>
        </h1>
        <p className="mt-2 text-sm text-white/55">
          {lightsOn} light{lightsOn === 1 ? '' : 's'} on · {thermostat ? `${thermostat.current}° inside · ` : ''}{user.role === 'guest' ? `${devices.length} devices you can control` : unlocked ? <span className="text-amber-300">{unlocked} door unlocked</span> : 'all doors locked'}
        </p>

        <div className="mt-6"><Assistant ask={ask} /></div>

        {state.scenes.length > 0 && <>
          <h2 className="mb-3 mt-8 font-display text-sm font-semibold uppercase tracking-widest text-white/60">Scenes</h2>
          <ScenesBar scenes={state.scenes} run={runScene} />
        </>}

        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <main>
            <nav className="mb-4 flex gap-2 overflow-x-auto pb-1" aria-label="Rooms">
              {[{ id: 'all', name: 'All rooms', icon: '🏠' }, ...state.rooms].map((r) => (
                <button key={r.id} onClick={() => setRoom(r.id)}
                        className={`shrink-0 rounded-full px-4 py-2 text-sm transition-colors ${room === r.id ? 'bg-white text-ink' : 'bg-white/6 text-white/70 hover:bg-white/12'}`}>
                  <span className="mr-1.5">{r.icon}</span>{r.name}
                </button>
              ))}
            </nav>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {devices.map((d) => <DeviceCard key={d.id} device={d} update={update} roomName={room === 'all' ? roomName(d.room) : undefined} />)}
            </div>
          </main>

          <aside className="space-y-6">
            {thermostat && <ClimateCard t={thermostat} outside={state.outsideTemp} update={update} />}
            {user.role === 'owner' && <HardwarePanel session={session} devices={state.devices} />}
            {user.role === 'owner' && <PeoplePanel session={session} rooms={state.rooms} />}
            {user.role !== 'guest' && <EnergyCard state={state} />}
            <ActivityFeed items={state.activity} />
          </aside>
        </div>

        <footer className="mt-12 text-center text-[11px] text-white/30">
          IQHomes · React + Node.js + Socket.io · built by Kshitij Dua
        </footer>
      </div>
      <Toasts items={toasts} dismiss={dismiss} />
    </BeamsBackground>
  );
}
