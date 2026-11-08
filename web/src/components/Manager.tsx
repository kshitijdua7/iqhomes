import { useEffect, useState } from 'react';
import { api, type Session } from '../session';
import type { Automation, Condition, Device, HomeState, Trigger } from '../types';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/* ======================= Automations: drag-and-drop IF / AND / THEN builder ======================= */

type Block = { id: string; label: string; icon: string; kind: 'trigger' | 'condition'; make: () => Trigger | Condition };

const PALETTE: Block[] = [
  { id: 't-time', label: 'At a time', icon: '🕒', kind: 'trigger', make: () => ({ type: 'time', at: '23:00' }) },
  { id: 't-sunset', label: 'At sunset', icon: '🌇', kind: 'trigger', make: () => ({ type: 'sun', event: 'sunset' }) },
  { id: 't-sunrise', label: 'At sunrise', icon: '🌅', kind: 'trigger', make: () => ({ type: 'sun', event: 'sunrise' }) },
  { id: 't-sensor', label: 'Sensor fires', icon: '📡', kind: 'trigger', make: () => ({ type: 'sensor', deviceId: '', triggered: true }) },
  { id: 't-device', label: 'Device changes', icon: '💡', kind: 'trigger', make: () => ({ type: 'device', deviceId: '', field: 'on', value: true }) },
  { id: 't-security', label: 'Security mode', icon: '🛡️', kind: 'trigger', make: () => ({ type: 'security', mode: 'away' }) },
  { id: 'c-dark', label: "It's dark", icon: '🌙', kind: 'condition', make: () => ({ type: 'dark' }) },
  { id: 'c-away', label: 'Nobody home', icon: '🏃', kind: 'condition', make: () => ({ type: 'nobodyHome' }) },
  { id: 'c-between', label: 'Between times', icon: '⏱️', kind: 'condition', make: () => ({ type: 'between', after: '22:00', before: '06:00' }) },
  { id: 'c-device', label: 'Device is…', icon: '🔌', kind: 'condition', make: () => ({ type: 'device', deviceId: '', field: 'on', value: true }) },
];

const fieldFor = (d?: Device): 'on' | 'locked' | 'open' => (d?.type === 'lock' ? 'locked' : d?.type === 'garage' ? 'open' : 'on');

export function AutomationsPanel({ session, state }: { session: Session; state: HomeState }) {
  const [building, setBuilding] = useState(false);
  const [templates, setTemplates] = useState<Omit<Automation, 'id' | 'enabled'>[]>([]);
  const list = state.automations ?? [];
  const token = session.token;
  useEffect(() => { api<typeof templates>('/api/automations/templates', { token }).then(setTemplates).catch(() => {}); }, [token]);

  const toggle = (a: Automation) => api(`/api/automations/${a.id}`, { method: 'PATCH', body: { enabled: !a.enabled }, token }).catch(() => {});
  const run = (a: Automation) => api(`/api/automations/${a.id}`, { method: 'PATCH', body: { run: true }, token }).catch(() => {});
  const remove = (a: Automation) => api(`/api/automations/${a.id}`, { method: 'DELETE', token }).catch(() => {});

  return (
    <section className="glass rounded-3xl p-5">
      <header className="flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-white/60">Automations</h2>
        <button onClick={() => setBuilding(!building)} className="rounded-full bg-white/8 px-3 py-1 text-xs hover:bg-white/15">{building ? 'Close' : '+ New'}</button>
      </header>
      {building && <Builder session={session} state={state} templates={templates} onDone={() => setBuilding(false)} />}
      {!building && list.length === 0 && (
        <p className="mt-3 text-xs leading-relaxed text-white/45">No automations yet. Tap <b>+ New</b>, or just tell Nova: <i>"turn on the porch light at sunset every day"</i>.</p>
      )}
      <ul className="mt-3 space-y-2">
        {list.map((a) => (
          <li key={a.id} className={`rounded-2xl px-3 py-2.5 ${a.enabled ? 'bg-white/5' : 'bg-white/2 opacity-60'}`}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{a.name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                  <Chip tone="when">{triggerText(a.trigger, state)}</Chip>
                  {a.conditions.map((c, i) => <Chip key={i} tone="if">{conditionText(c, state)}</Chip>)}
                  <Chip tone="then">{a.then}</Chip>
                </div>
                {a.lastRun && <div className="mt-1 text-[10px] text-white/35">Last ran {new Date(a.lastRun).toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => run(a)} title="Run now" className="rounded-full px-2 py-1 text-xs text-white/50 hover:bg-white/10">▶</button>
                <button onClick={() => toggle(a)} role="switch" aria-checked={a.enabled} aria-label={`Enable ${a.name}`}
                        className={`relative h-5 w-9 rounded-full transition-colors ${a.enabled ? 'bg-nova' : 'bg-white/15'}`}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${a.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                </button>
                <button onClick={() => remove(a)} aria-label={`Delete ${a.name}`} className="rounded-full px-2 py-1 text-xs text-white/35 hover:bg-white/10 hover:text-white">✕</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Chip({ tone, children }: { tone: 'when' | 'if' | 'then'; children: React.ReactNode }) {
  const style = { when: 'bg-aqua/15 text-aqua', if: 'bg-amber-300/15 text-amber-200', then: 'bg-nova/20 text-[#b9c6ff]' }[tone];
  const label = { when: 'WHEN', if: 'AND', then: 'THEN' }[tone];
  return <span className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 ${style}`}><b className="text-[9px] opacity-70">{label}</b><span className="truncate">{children}</span></span>;
}

function devName(state: HomeState, id: string) { return state.devices.find((d) => d.id === id)?.name ?? 'pick a device'; }
function triggerText(t: Trigger, s: HomeState) {
  switch (t.type) {
    case 'time': return `${t.at}${t.days?.length && t.days.length < 7 ? ` (${t.days.map((d) => DAYS[d]).join('')})` : ''}`;
    case 'sun': return `${t.offset ? `${Math.abs(t.offset)}m ${t.offset < 0 ? 'before' : 'after'} ` : ''}${t.event}`;
    case 'sensor': return `${devName(s, t.deviceId)} ${t.triggered ? 'fires' : 'clears'}`;
    case 'device': return `${devName(s, t.deviceId)} → ${t.field === 'locked' ? (t.value ? 'locked' : 'unlocked') : t.field === 'open' ? (t.value ? 'open' : 'closed') : t.value ? 'on' : 'off'}`;
    case 'security': return `security ${t.mode}`;
  }
}
function conditionText(c: Condition, s: HomeState) {
  switch (c.type) {
    case 'dark': return "it's dark";
    case 'nobodyHome': return 'nobody home';
    case 'between': return `${c.after}–${c.before}`;
    case 'security': return `security ${c.mode}`;
    case 'device': return `${devName(s, c.deviceId)} is ${c.field === 'locked' ? (c.value ? 'locked' : 'unlocked') : c.field === 'open' ? (c.value ? 'open' : 'closed') : c.value ? 'on' : 'off'}`;
  }
}

function Builder({ session, state, templates, onDone }: { session: Session; state: HomeState; templates: Omit<Automation, 'id' | 'enabled'>[]; onDone: () => void }) {
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [then, setThen] = useState('');
  const [over, setOver] = useState<'when' | 'if' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sensors = state.devices.filter((d) => d.type === 'sensor');
  const switchable = state.devices.filter((d) => ['light', 'plug', 'fan', 'tv', 'lock', 'garage'].includes(d.type));

  const drop = (block: Block, slot: 'when' | 'if') => {
    if (block.kind === 'trigger' && slot === 'when') setTrigger(block.make() as Trigger);
    else if (block.kind === 'condition' && slot === 'if' && conditions.length < 4) setConditions([...conditions, block.make() as Condition]);
  };
  const onDrop = (slot: 'when' | 'if') => (e: React.DragEvent) => {
    e.preventDefault(); setOver(null);
    const b = PALETTE.find((x) => x.id === e.dataTransfer.getData('text/plain'));
    if (b) drop(b, slot);
  };

  async function save(tpl?: Omit<Automation, 'id' | 'enabled'>) {
    setError(null);
    const body = tpl ?? { name: name || 'My automation', trigger, conditions, then };
    try { await api('/api/automations', { body, token: session.token }); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); }
  }

  const slotCls = (active: boolean) => `min-h-12 rounded-2xl border-2 border-dashed p-2 transition-colors ${active ? 'border-nova bg-nova/10' : 'border-white/10'}`;
  const sel = 'rounded-lg border border-white/10 bg-[#141726] px-1.5 py-1 text-xs outline-none';

  return (
    <div className="fade-in mt-4 space-y-3">
      {templates.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-wider text-white/40">Quick start</div>
          <div className="flex flex-wrap gap-1.5">
            {templates.map((t) => <button key={t.name} onClick={() => save(t)} className="rounded-full bg-white/6 px-2.5 py-1 text-[11px] text-white/70 hover:bg-white/12">+ {t.name}</button>)}
          </div>
        </div>
      )}

      <div>
        <div className="mb-1.5 text-[11px] uppercase tracking-wider text-white/40">Drag blocks into the rule (or tap them)</div>
        <div className="flex flex-wrap gap-1.5">
          {PALETTE.map((b) => (
            <button key={b.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', b.id)} onClick={() => drop(b, b.kind === 'trigger' ? 'when' : 'if')}
                    className={`cursor-grab rounded-xl px-2.5 py-1.5 text-[11px] active:cursor-grabbing ${b.kind === 'trigger' ? 'bg-aqua/15 text-aqua' : 'bg-amber-300/15 text-amber-200'}`}>
              {b.icon} {b.label}
            </button>
          ))}
        </div>
      </div>

      <div onDragOver={(e) => { e.preventDefault(); setOver('when'); }} onDragLeave={() => setOver(null)} onDrop={onDrop('when')} className={slotCls(over === 'when')}>
        <div className="mb-1 text-[10px] font-bold tracking-widest text-aqua">WHEN</div>
        {!trigger ? <p className="text-[11px] text-white/35">Drop a trigger here</p> : (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {trigger.type === 'time' && <>
              <input type="time" value={trigger.at} onChange={(e) => setTrigger({ ...trigger, at: e.target.value })} className={sel} />
              <div className="flex gap-0.5">{DAYS.map((d, i) => {
                const on = !trigger.days?.length || trigger.days.includes(i);
                return <button key={i} onClick={() => { const cur = trigger.days?.length ? trigger.days : [0, 1, 2, 3, 4, 5, 6]; const next = on ? cur.filter((x) => x !== i) : [...cur, i].sort(); setTrigger({ ...trigger, days: next.length === 7 ? undefined : next }); }}
                               className={`h-6 w-6 rounded-full text-[10px] ${on ? 'bg-aqua/30 text-white' : 'bg-white/5 text-white/40'}`}>{d}</button>;
              })}</div>
            </>}
            {trigger.type === 'sun' && <>
              <select value={trigger.event} onChange={(e) => setTrigger({ ...trigger, event: e.target.value as 'sunset' | 'sunrise' })} className={sel}><option value="sunset">Sunset</option><option value="sunrise">Sunrise</option></select>
              <select value={trigger.offset ?? 0} onChange={(e) => setTrigger({ ...trigger, offset: Number(e.target.value) })} className={sel}>
                {[-60, -30, -15, 0, 15, 30, 60].map((o) => <option key={o} value={o}>{o === 0 ? 'exactly' : `${Math.abs(o)} min ${o < 0 ? 'before' : 'after'}`}</option>)}
              </select>
            </>}
            {trigger.type === 'sensor' && <>
              <select value={trigger.deviceId} onChange={(e) => setTrigger({ ...trigger, deviceId: e.target.value })} className={sel}>
                <option value="">Pick a sensor…</option>{sensors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <select value={String(trigger.triggered)} onChange={(e) => setTrigger({ ...trigger, triggered: e.target.value === 'true' })} className={sel}><option value="true">fires</option><option value="false">clears</option></select>
            </>}
            {trigger.type === 'device' && <DeviceValue value={trigger} devices={switchable} onChange={(v) => setTrigger({ ...trigger, ...v })} sel={sel} />}
            {trigger.type === 'security' && (
              <select value={trigger.mode} onChange={(e) => setTrigger({ ...trigger, mode: e.target.value as 'away' })} className={sel}>
                <option value="away">Armed away</option><option value="home">Armed home</option><option value="disarmed">Disarmed</option>
              </select>
            )}
            <button onClick={() => setTrigger(null)} className="ml-auto text-white/40 hover:text-white">✕</button>
          </div>
        )}
      </div>

      <div onDragOver={(e) => { e.preventDefault(); setOver('if'); }} onDragLeave={() => setOver(null)} onDrop={onDrop('if')} className={slotCls(over === 'if')}>
        <div className="mb-1 text-[10px] font-bold tracking-widest text-amber-200">AND IF <span className="font-normal text-white/30">(optional)</span></div>
        {conditions.length === 0 && <p className="text-[11px] text-white/35">Drop conditions here</p>}
        <div className="space-y-1.5">
          {conditions.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
              <span>{PALETTE.find((b) => b.make().type === c.type && b.kind === 'condition')?.icon}</span>
              {c.type === 'dark' && "It's dark outside"}
              {c.type === 'nobodyHome' && 'Nobody is home (security Away)'}
              {c.type === 'between' && <>Between <input type="time" value={c.after} onChange={(e) => setConditions(conditions.map((x, j) => j === i ? { ...c, after: e.target.value } : x))} className={sel} />
                and <input type="time" value={c.before} onChange={(e) => setConditions(conditions.map((x, j) => j === i ? { ...c, before: e.target.value } : x))} className={sel} /></>}
              {c.type === 'device' && <DeviceValue value={c} devices={switchable} onChange={(v) => setConditions(conditions.map((x, j) => j === i ? { ...c, ...v } : x))} sel={sel} />}
              <button onClick={() => setConditions(conditions.filter((_, j) => j !== i))} className="ml-auto text-white/40 hover:text-white">✕</button>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-nova/30 bg-nova/5 p-2">
        <div className="mb-1 text-[10px] font-bold tracking-widest text-[#b9c6ff]">THEN NOVA WILL…</div>
        <input value={then} onChange={(e) => setThen(e.target.value)} placeholder="turn on the porch light and close the blinds"
               className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-nova/60" />
        <p className="mt-1 text-[10px] text-white/35">Anything you can say to Nova works here, including scenes like “good night”.</p>
      </div>

      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" maxLength={40}
             className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-nova/60" />
      {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}
      <button onClick={() => save()} disabled={!trigger || !then.trim()} className="w-full rounded-full bg-gradient-to-r from-nova to-nova-2 py-2 text-sm font-medium disabled:opacity-40">Save automation</button>
    </div>
  );
}

function DeviceValue({ value, devices, onChange, sel }: {
  value: { deviceId: string; field: 'on' | 'locked' | 'open'; value: boolean }; devices: Device[];
  onChange: (v: { deviceId?: string; field?: 'on' | 'locked' | 'open'; value?: boolean }) => void; sel: string;
}) {
  const d = devices.find((x) => x.id === value.deviceId);
  const field = fieldFor(d);
  const labels = field === 'locked' ? ['locked', 'unlocked'] : field === 'open' ? ['open', 'closed'] : ['on', 'off'];
  return <>
    <select value={value.deviceId} onChange={(e) => { const nd = devices.find((x) => x.id === e.target.value); onChange({ deviceId: e.target.value, field: fieldFor(nd) }); }} className={sel}>
      <option value="">Pick a device…</option>{devices.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
    </select>
    <select value={String(value.value)} onChange={(e) => onChange({ value: e.target.value === 'true', field })} className={sel}>
      <option value="true">{labels[0]}</option><option value="false">{labels[1]}</option>
    </select>
  </>;
}

/* ======================= Device manager: rooms + devices ======================= */

const TYPES: [string, string][] = [['light', '💡 Light'], ['plug', '🔌 Plug'], ['fan', '🌀 Fan'], ['blinds', '🪟 Blinds'], ['tv', '📺 TV'], ['lock', '🔒 Lock'], ['garage', '🚗 Garage door'], ['sensor', '📡 Sensor']];
const ROOM_ICONS = ['🛋️', '🍳', '🛏️', '💻', '🚪', '🛁', '🧺', '🚗', '🌳', '🎮', '👶', '🏋️', '🍽️', '🏠'];

export function DeviceManager({ session, state }: { session: Session; state: HomeState }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newRoom, setNewRoom] = useState({ name: '', icon: '🛁' });
  const [newDev, setNewDev] = useState({ name: '', type: 'light', room: state.rooms[0]?.id ?? '', kind: 'motion' });
  const token = session.token;
  const call = async (path: string, method: string, body?: unknown) => {
    setError(null);
    try { await api(path, { method, body, token }); return true; } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); return false; }
  };
  const field = 'rounded-lg border border-white/10 bg-[#141726] px-2 py-1.5 text-xs outline-none focus:border-nova/60';

  return (
    <section className="glass rounded-3xl p-5">
      <header className="flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-white/60">Devices & rooms</h2>
        <button onClick={() => setOpen(!open)} className="rounded-full bg-white/8 px-3 py-1 text-xs hover:bg-white/15">{open ? 'Done' : 'Manage'}</button>
      </header>
      {!open ? (
        <p className="mt-2 text-xs text-white/45">{state.rooms.length} rooms · {state.devices.length} devices. Add, rename, move or delete them here.</p>
      ) : (
        <div className="fade-in mt-4 space-y-4">
          {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}

          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-wider text-white/40">Rooms</div>
            <ul className="space-y-1.5">
              {state.rooms.map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <select defaultValue={r.icon} onChange={(e) => void call(`/api/rooms/${r.id}`, 'PATCH', { icon: e.target.value })} className={`${field} w-14`} aria-label="Room icon">
                    {[...new Set([r.icon, ...ROOM_ICONS])].map((i) => <option key={i}>{i}</option>)}
                  </select>
                  <input defaultValue={r.name} onBlur={(e) => e.target.value !== r.name && void call(`/api/rooms/${r.id}`, 'PATCH', { name: e.target.value })} className={`${field} flex-1`} aria-label="Room name" />
                  <span className="w-6 text-center text-[10px] text-white/35">{state.devices.filter((d) => d.room === r.id).length}</span>
                  <button onClick={() => void call(`/api/rooms/${r.id}`, 'DELETE')} aria-label={`Delete ${r.name}`} className="rounded-full px-2 text-xs text-white/35 hover:text-red-300">✕</button>
                </li>
              ))}
            </ul>
            <form onSubmit={async (e) => { e.preventDefault(); if (await call('/api/rooms', 'POST', newRoom)) setNewRoom({ name: '', icon: '🛁' }); }} className="mt-2 flex gap-2">
              <select value={newRoom.icon} onChange={(e) => setNewRoom({ ...newRoom, icon: e.target.value })} className={`${field} w-14`}>{ROOM_ICONS.map((i) => <option key={i}>{i}</option>)}</select>
              <input value={newRoom.name} onChange={(e) => setNewRoom({ ...newRoom, name: e.target.value })} placeholder="New room (e.g. Bathroom)" className={`${field} flex-1`} />
              <button className="rounded-lg bg-white/10 px-3 text-xs hover:bg-white/15">Add</button>
            </form>
          </div>

          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-wider text-white/40">Devices</div>
            <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {state.devices.map((d) => (
                <li key={d.id} className="flex items-center gap-2">
                  <input defaultValue={d.name} onBlur={(e) => e.target.value !== d.name && void call(`/api/devices/${d.id}`, 'PATCH', { name: e.target.value })} className={`${field} min-w-0 flex-1`} aria-label="Device name" />
                  <select value={d.room} onChange={(e) => void call(`/api/devices/${d.id}`, 'PATCH', { room: e.target.value })} className={`${field} w-28`} aria-label="Room">
                    {state.rooms.map((r) => <option key={r.id} value={r.id}>{r.icon} {r.name}</option>)}
                  </select>
                  <button onClick={() => confirm(`Delete ${d.name}?`) && void call(`/api/devices/${d.id}`, 'DELETE')} aria-label={`Delete ${d.name}`} className="rounded-full px-2 text-xs text-white/35 hover:text-red-300">✕</button>
                </li>
              ))}
            </ul>
            <form onSubmit={async (e) => { e.preventDefault(); if (await call('/api/devices', 'POST', newDev)) setNewDev({ ...newDev, name: '' }); }} className="mt-2 grid grid-cols-2 gap-2">
              <input value={newDev.name} onChange={(e) => setNewDev({ ...newDev, name: e.target.value })} placeholder="New device name" className={`${field} col-span-2`} />
              <select value={newDev.type} onChange={(e) => setNewDev({ ...newDev, type: e.target.value })} className={field}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <select value={newDev.room} onChange={(e) => setNewDev({ ...newDev, room: e.target.value })} className={field}>{state.rooms.map((r) => <option key={r.id} value={r.id}>{r.icon} {r.name}</option>)}</select>
              {newDev.type === 'sensor' && (
                <select value={newDev.kind} onChange={(e) => setNewDev({ ...newDev, kind: e.target.value })} className={`${field} col-span-2`}>
                  <option value="motion">Motion</option><option value="contact">Door / window</option><option value="smoke">Smoke</option><option value="co">Carbon monoxide</option><option value="leak">Water leak</option>
                </select>
              )}
              <button className="col-span-2 rounded-lg bg-gradient-to-r from-nova to-nova-2 py-1.5 text-xs font-medium">Add device</button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
