import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Device, DevicePatch, HomeState } from './types';

export interface AssistantResult { understood: boolean; reply: string; patches: DevicePatch[]; scenes: string[] }

/** Keeps a live copy of the house in sync with the server over WebSockets. */
export function useHome() {
  const [state, setState] = useState<HomeState | null>(null);
  const [connected, setConnected] = useState(false);
  const socket = useRef<Socket | null>(null);

  useEffect(() => {
    const s = io({ transports: ['websocket', 'polling'] });
    socket.current = s;
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('state', (next: HomeState) => setState(next));
    s.on('tick', ({ devices, energy }: Pick<HomeState, 'devices' | 'energy'>) =>
      setState((prev) => (prev ? { ...prev, devices, energy } : prev)));
    return () => { s.disconnect(); };
  }, []);

  /** Optimistic update: the UI changes instantly, then the server confirms to every screen. */
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

  return { state, connected, update, runScene, ask };
}
