import { useEffect, useState } from 'react';
import { api, ROLE_LABEL, type Session } from '../session';
import type { PublicUser } from '../types';

/** Sign-in: pick who you are and enter your PIN, or enter the 6-digit code from a guest pass. */
export function Login({ onSignedIn }: { onSignedIn: (s: Session) => void }) {
  const [profiles, setProfiles] = useState<PublicUser[] | null>(null);
  const [picked, setPicked] = useState<PublicUser | 'guest' | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  const [demo, setDemo] = useState<{ demo: boolean; pins?: { owner: string; family: string } } | null>(null);
  useEffect(() => {
    api<PublicUser[]>('/api/profiles').then(setProfiles).catch(() => setError("Can't reach the house. Is the server running?"));
    api<{ demo: boolean; pins?: { owner: string; family: string } }>('/api/demo').then(setDemo).catch(() => {});
  }, []);

  async function demoLogin(p: PublicUser) {
    const pin = p.role === 'owner' ? demo?.pins?.owner : demo?.pins?.family;
    if (!pin) return;
    try { onSignedIn(await api<Session>('/api/login', { body: { userId: p.id, pin } })); } catch (e) { setError(e instanceof Error ? e.message : 'Sign-in failed'); }
  }

  // A guest link like /?guest=123456 skips straight to the code with it filled in.
  useEffect(() => {
    const code = new URLSearchParams(location.search).get('guest');
    if (code && /^\d{6}$/.test(code)) { setPicked('guest'); setPin(code); }
  }, []);

  const length = picked === 'guest' ? 6 : 4;

  async function submit(value: string) {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api<Session>('/api/login', { body: { userId: picked === 'guest' ? undefined : picked.id, pin: value } });
      if (picked === 'guest') history.replaceState(null, '', '/');
      onSignedIn(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
      setPin('');
      setShake((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  function press(k: string) {
    if (k === '⌫') return setPin((p) => p.slice(0, -1));
    const next = (pin + k).slice(0, 8);
    setPin(next);
    if (next.length === length) void submit(next);
  }

  useEffect(() => {
    if (!picked) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('⌫');
      else if (e.key === 'Enter' && pin.length >= 4) void submit(pin);
      else if (e.key === 'Escape') { setPicked(null); setPin(''); setError(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <div className="orb mx-auto h-16 w-16" data-mode="idle"><span className="orb-glow" /><span className="orb-core" /></div>
        <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight">IQHomes</h1>
        <p className="mt-1 text-sm text-white/55">{picked ? (picked === 'guest' ? 'Enter your 6-digit guest code' : `Hi ${picked.name}, enter your PIN`) : 'Who’s home?'}</p>

        {!picked && demo?.demo && profiles && (
          <div className="mt-6 rounded-2xl border border-aqua/30 bg-aqua/10 p-4 text-left">
            <div className="text-sm font-semibold text-aqua">🧪 Public demo</div>
            <p className="mt-1 text-xs text-white/60">Explore everything. The house resets every hour, so break whatever you like.</p>
            <div className="mt-3 flex gap-2">
              {profiles.map((p) => (
                <button key={p.id} onClick={() => demoLogin(p)} className="flex-1 rounded-full bg-gradient-to-r from-nova to-nova-2 py-2 text-sm font-medium">
                  {p.avatar} Enter as {p.role === 'owner' ? 'owner' : 'family'}
                </button>
              ))}
            </div>
          </div>
        )}
        {!picked ? (
          <div className="mt-8 space-y-3">
            {profiles?.map((p) => (
              <button key={p.id} onClick={() => { setPicked(p); setPin(''); setError(null); }}
                      className="glass flex w-full items-center gap-4 rounded-2xl px-4 py-3.5 text-left transition-colors hover:bg-white/10">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-xl">{p.avatar}</span>
                <span className="flex-1">
                  <span className="block font-medium">{p.name}</span>
                  <span className="block text-xs text-white/45">{ROLE_LABEL[p.role]}</span>
                </span>
                <span className="text-white/30">›</span>
              </button>
            ))}
            {!profiles && !error && <p className="text-sm text-white/40">Loading…</p>}
            <button onClick={() => { setPicked('guest'); setPin(''); setError(null); }}
                    className="flex w-full items-center gap-4 rounded-2xl border border-dashed border-white/15 px-4 py-3.5 text-left transition-colors hover:bg-white/5">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-white/5 text-xl">🎟️</span>
              <span className="flex-1">
                <span className="block font-medium">I have a guest pass</span>
                <span className="block text-xs text-white/45">Use the code the owner shared with you</span>
              </span>
            </button>
          </div>
        ) : (
          <div className="mt-8">
            <div key={shake} className={`flex justify-center gap-3 ${shake ? 'shake' : ''}`} aria-live="polite" aria-label={`${pin.length} of ${length} digits entered`}>
              {Array.from({ length }, (_, i) => (
                <span key={i} className={`h-3.5 w-3.5 rounded-full transition-all ${i < pin.length ? 'scale-110 bg-gradient-to-r from-nova to-nova-2' : 'bg-white/15'}`} />
              ))}
            </div>
            <div className="mx-auto mt-8 grid max-w-[264px] grid-cols-3 gap-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) =>
                k ? (
                  <button key={i} onClick={() => press(k)} disabled={busy}
                          aria-label={k === '⌫' ? 'Delete' : k}
                          className="glass h-16 rounded-2xl font-display text-2xl font-light transition-colors hover:bg-white/10 active:scale-95 disabled:opacity-50">
                    {k}
                  </button>
                ) : <span key={i} />,
              )}
            </div>
            <button onClick={() => { setPicked(null); setPin(''); setError(null); }} className="mt-6 text-sm text-white/50 hover:text-white">← Back</button>
          </div>
        )}

        {error && <p role="alert" className="mt-5 text-sm text-amber-300">{error}</p>}
        {!picked && profiles && (
          <p className="mt-8 text-[11px] text-white/30">Demo PINs: owner 1234 · family 2222</p>
        )}
      </div>
    </div>
  );
}
