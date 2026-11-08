import { useCallback, useEffect, useState } from 'react';
import { api } from './session';

/** Registers the service worker once, at startup. */
export function registerServiceWorker() {
  if ('serviceWorker' in navigator && (import.meta.env.PROD || location.hostname === 'localhost')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
  }
}

interface InstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

/** "Install app" button support. iPhones don't fire the prompt event, so we show Share → Add to Home Screen instructions there. */
export function useInstall() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const standalone = typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);
  const [installed, setInstalled] = useState(standalone);
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as InstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  const install = useCallback(async () => {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    setPrompt(null);
  }, [prompt]);

  return { canInstall: !!prompt && !installed, install, installed, iosHint: ios && !installed };
}

const b64ToBytes = (b64: string) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

export type PushStatus = 'unsupported' | 'insecure' | 'denied' | 'off' | 'on' | 'busy';

/** Turns real push notifications on/off for the signed-in person on this device. */
export function usePush(token: string | undefined) {
  const [status, setStatus] = useState<PushStatus>('busy');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!window.isSecureContext) return setStatus('insecure');
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return setStatus('unsupported');
    if (Notification.permission === 'denied') return setStatus('denied');
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    setStatus(sub ? 'on' : 'off');
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const enable = useCallback(async () => {
    if (!token) return;
    setError(null);
    setStatus('busy');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { await refresh(); return; }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const { key } = await api<{ key: string }>('/api/push/key');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      await api('/api/push/subscribe', { body: sub.toJSON(), token });
      await api('/api/push/test', { body: {}, token });
      setStatus('on');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn on notifications');
      await refresh();
    }
  }, [token, refresh]);

  const disable = useCallback(async () => {
    setStatus('busy');
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api('/api/push/unsubscribe', { body: { endpoint: sub.endpoint }, token }).catch(() => {});
      await sub.unsubscribe();
    }
    await refresh();
  }, [token, refresh]);

  return { status, error, enable, disable };
}
