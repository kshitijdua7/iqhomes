import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Device, DevicePatch, HomeState } from './types';

export interface AssistantResult { understood: boolean; reply: string; patches: DevicePatch[]; scenes: string[] }
export interface Toast { id: number; title: string; body?: string; tone: 'info' | 'warn' }

/** Keeps a live copy of the house in sync with the server over WebSockets, as the signed-in person. */
export function useHome(token: string, onSignedOut: () => void) {
  const [state, setState] = useState<HomeState | null>(null);
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const socket = useRef<Socket | null>(null);
  const toastId = useRef(0);
  const signedOut = useRef(onSignedOut);
  useEffect(() => { signedOut.current = onSignedOut; }, [onSignedOut]);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = toastId.current++;
    setToasts((p) => [...p.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), 6000);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((p) => p.filter((x) => x.id !== id)), []);

  useEffect(() => {
    const s = io({ transports: ['websocket', 'polling'], auth: { token } });
    socket.current = s;
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', (err) => { if (err.message === 'unauthorized') signedOut.current(); });
    s.on('session:expired', () => signedOut.current());
    s.on('state', (next: HomeState) => setState(next));
    s.on('tick', ({ devices, energy }: Pick<HomeState, 'devices' | 'energy'>) =>
      setState((prev) => (prev ? { ...prev, devices, energy } : prev)));
    s.on('alert', (a: { title: string; body: string }) => toast({ title: a.title, body: a.body, tone: 'warn' }));
    s.on('denied', (msg: string) => toast({ title: '🚫 Not allowed', body: msg, tone: 'warn' }));
    return () => { s.disconnect(); };
  }, [token, toast]);

  /** Optimistic update: the UI changes instantly, then the server confirms (or corrects) on every screen. */
  const update = useCallback((id: string, changes: Partial<Device>) => {
    setState((prev) => prev && {
      ...prev,
      devices: prev.devices.map((d) => (d.id === id ? ({ ...d, ...changes } as Device) : d)),
    });
    socket.current?.emit('device:update', { id, changes });
  }, []);

  const runScene = useCallback((id: string) => socket.current?.emit('scene:run', id), []);

  const ask = useCallback(
    (text: string) =>
      new Promise<AssistantResult>((resolve) => {
        if (!socket.current?.connected) {
          resolve({ understood: false, reply: "I can't reach the house right now. Is the server running?", patches: [], scenes: [] });
          return;
        }
        socket.current.timeout(5000).emit('assistant:ask', text, (err: unknown, result: AssistantResult) =>
          resolve(err ? { understood: false, reply: 'That took too long, try again.', patches: [], scenes: [] } : result));
      }),
    [],
  );

  return { state, connected, update, runScene, ask, toasts, toast, dismiss };
}
