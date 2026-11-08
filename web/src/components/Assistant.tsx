import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssistantResult } from '../useHome';
import { useVoice } from '../useVoice';

interface Turn { id: number; who: 'you' | 'nova'; text: string; ok?: boolean }

const SUGGESTIONS = [
  'Dim the living room to 30% and close the blinds',
  "It's movie night",
  "I'm cold",
  'Is the front door locked?',
  'Make the bedroom lights purple',
  'How much power are we using?',
];

export function Assistant({ ask }: { ask: (t: string) => Promise<AssistantResult> }) {
  const [turns, setTurns] = useState<Turn[]>([
    { id: 0, who: 'nova', text: 'Hi, I\'m Nova. Tap the orb and talk to me, or type below.' },
  ]);
  const [text, setText] = useState('');
  const idRef = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);

  const onCommand = useCallback(async (t: string) => {
    setTurns((p): Turn[] => [...p, { id: idRef.current++, who: 'you', text: t }]);
    const r = await ask(t);
    setTurns((p): Turn[] => [...p, { id: idRef.current++, who: 'nova' as const, text: r.reply, ok: r.understood }].slice(-30));
    return r.reply;
  }, [ask]);

  const voice = useVoice(onCommand);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [turns]);

  const submit = (t: string) => { if (!t.trim()) return; setText(''); void voice.handle(t); };

  const label = { idle: voice.wakeWord ? 'Say "Hey Nova…"' : 'Tap to talk', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…' }[voice.mode];

  return (
    <section className="glass relative overflow-hidden rounded-[2rem] p-5 sm:p-7">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
        {/* Orb */}
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={voice.pushToTalk} disabled={!voice.supported}
            aria-label={voice.supported ? 'Talk to Nova' : 'Voice not supported in this browser'}
            className="orb h-36 w-36 cursor-pointer outline-none transition-transform hover:scale-[1.03] active:scale-95 disabled:cursor-not-allowed sm:h-44 sm:w-44"
            data-mode={voice.mode}
          >
            <span className="ring" /><span className="ring" /><span className="ring" />
            <span className="orb-glow" />
            <span className="orb-core" />
            <span className="relative z-10 grid h-full place-items-center text-3xl">{voice.mode === 'listening' ? '🎙️' : ''}</span>
          </button>
          <div className="text-center">
            <div className="font-display text-sm font-semibold tracking-wide">{label}</div>
            <div className="mt-0.5 h-4 max-w-56 truncate text-xs text-white/50">{voice.mode === 'listening' ? voice.interim : ''}</div>
          </div>
          <div className="flex gap-2 text-[11px]">
            <button onClick={() => voice.setWakeWord(!voice.wakeWord)} disabled={!voice.supported}
                    className={`rounded-full px-3 py-1 transition-colors ${voice.wakeWord ? 'bg-nova text-white' : 'bg-white/8 text-white/60 hover:text-white'}`}>
              Wake word {voice.wakeWord ? 'on' : 'off'}
            </button>
            <button onClick={() => voice.setVoiceOut(!voice.voiceOut)}
                    className={`rounded-full px-3 py-1 transition-colors ${voice.voiceOut ? 'bg-white/15 text-white' : 'bg-white/8 text-white/60'}`}>
              {voice.voiceOut ? '🔊 Voice' : '🔇 Muted'}
            </button>
          </div>
          {!voice.supported && <p className="max-w-56 text-center text-[11px] text-amber-300/80">Voice needs Chrome or Edge. Typing works everywhere.</p>}
        </div>

        {/* Conversation */}
        <div className="flex min-h-0 flex-col">
          <div ref={listRef} className="h-48 space-y-2 overflow-y-auto pr-1 sm:h-56" aria-live="polite">
            {turns.map((t) => (
              <div key={t.id} className={`fade-in flex ${t.who === 'you' ? 'justify-end' : ''}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                  t.who === 'you' ? 'rounded-br-md bg-nova/80 text-white' : t.ok === false ? 'rounded-bl-md bg-amber-400/10 text-amber-100' : 'rounded-bl-md bg-white/8 text-white/90'}`}>
                  {t.text}
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); submit(text); }} className="mt-3 flex gap-2">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask Nova anything about your home…"
                   className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none placeholder:text-white/30 focus:border-nova" />
            <button className="rounded-full bg-gradient-to-r from-nova to-nova-2 px-5 text-sm font-medium transition-opacity hover:opacity-90">Send</button>
          </form>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => submit(s)} className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-white/55 transition-colors hover:border-white/25 hover:text-white">
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
