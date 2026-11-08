import { useCallback, useEffect, useRef, useState } from 'react';

/* The Web Speech API isn't in TypeScript's built-in types yet, so we describe the bits we use. */
interface SpeechResultEvent { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }
interface Recognizer {
  continuous: boolean; interimResults: boolean; lang: string;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
type RecognizerCtor = new () => Recognizer;

const Ctor: RecognizerCtor | undefined =
  typeof window !== 'undefined'
    ? ((window as unknown as Record<string, RecognizerCtor>).SpeechRecognition ??
       (window as unknown as Record<string, RecognizerCtor>).webkitSpeechRecognition)
    : undefined;

const WAKE = /\b(hey |ok |okay )?(nova|noah|nover|innova)\b/i;

export type VoiceMode = 'idle' | 'listening' | 'thinking' | 'speaking';

/**
 * Two ways to talk to Nova:
 *  - push-to-talk: tap the mic, say one command
 *  - wake word: always listening in the background, reacts to "Hey Nova ..."
 */
export function useVoice(onCommand: (text: string) => Promise<string>, lang: 'en' | 'fr' = 'en') {
  const supported = Boolean(Ctor);
  const [mode, setMode] = useState<VoiceMode>('idle');
  const [interim, setInterim] = useState('');
  const [wakeWord, setWakeWord] = useState(false);
  const [voiceOut, setVoiceOut] = useState(true);
  const rec = useRef<Recognizer | null>(null);
  const awaitingCommand = useRef(false);
  const wakeRef = useRef(wakeWord);
  const busy = useRef(false);
  wakeRef.current = wakeWord;

  const speak = useCallback((text: string) => new Promise<void>((resolve) => {
    if (!voiceOut || !('speechSynthesis' in window)) return resolve();
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    u.voice = lang === 'fr'
      ? voices.find((v) => /^fr-CA/i.test(v.lang)) ?? voices.find((v) => /Amélie|Thomas|Google français/i.test(v.name)) ?? voices.find((v) => v.lang.startsWith('fr')) ?? null
      : voices.find((v) => /Samantha|Google UK English Female|Aria|Jenny|Zira/i.test(v.name)) ?? voices.find((v) => v.lang.startsWith('en')) ?? null;
    u.lang = lang === 'fr' ? 'fr-CA' : 'en-CA';
    u.rate = 1.03; u.pitch = 1.05;
    u.onend = () => resolve(); u.onerror = () => resolve();
    setMode('speaking');
    window.speechSynthesis.speak(u);
  }), [voiceOut, lang]);

  const handle = useCallback(async (text: string) => {
    if (busy.current || !text.trim()) return;
    busy.current = true;
    setMode('thinking');
    const reply = await onCommand(text);
    await speak(reply);
    setMode('idle');
    busy.current = false;
  }, [onCommand, speak]);

  const stop = useCallback(() => {
    rec.current?.abort(); rec.current = null; setInterim('');
    setMode((m) => (m === 'listening' ? 'idle' : m));
  }, []);

  const start = useCallback((continuous: boolean) => {
    if (!Ctor) return;
    rec.current?.abort();
    const r = new Ctor();
    r.lang = lang === 'fr' ? 'fr-CA' : 'en-CA'; r.interimResults = true; r.continuous = continuous;
    r.onresult = (e) => {
      let finalText = ''; let partial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else partial += t;
      }
      if (!continuous) {
        setInterim(partial || finalText);
        if (finalText) { setInterim(finalText); void handle(finalText); }
        return;
      }
      // wake-word mode: only react after "Nova" is heard
      const heard = finalText || partial;
      if (WAKE.test(heard) || awaitingCommand.current) {
        setMode((m) => (m === 'idle' ? 'listening' : m));
        setInterim(heard);
      }
      if (!finalText) return;
      const afterWake = finalText.split(WAKE).pop()?.trim() ?? '';
      if (WAKE.test(finalText)) {
        if (afterWake.split(' ').length >= 2) { awaitingCommand.current = false; void handle(afterWake); }
        else { awaitingCommand.current = true; void speak(lang === 'fr' ? 'Oui?' : 'Yes?').then(() => setMode('listening')); }
      } else if (awaitingCommand.current) {
        awaitingCommand.current = false; void handle(finalText);
      }
    };
    r.onerror = (e) => { if (e.error === 'not-allowed') { setWakeWord(false); setMode('idle'); } };
    r.onend = () => {
      // Browsers stop listening after a while; restart if wake-word mode is still on.
      if (continuous && wakeRef.current) { try { r.start(); } catch { /* already running */ } }
      else if (!busy.current) setMode((m) => (m === 'listening' ? 'idle' : m));
    };
    rec.current = r;
    try { r.start(); } catch { /* ignore double start */ }
    if (!continuous) setMode('listening');
  }, [handle, speak, lang]);

  const pushToTalk = useCallback(() => {
    if (mode === 'listening' && !wakeWord) return stop();
    if (mode === 'speaking') { window.speechSynthesis.cancel(); setMode('idle'); }
    setInterim('');
    start(false);
  }, [mode, wakeWord, start, stop]);

  useEffect(() => {
    if (wakeWord) start(true); else stop();
    return () => { rec.current?.abort(); };
  }, [wakeWord]); // eslint-disable-line react-hooks/exhaustive-deps

  return { supported, mode, interim, wakeWord, setWakeWord, voiceOut, setVoiceOut, pushToTalk, handle, setInterim };
}
