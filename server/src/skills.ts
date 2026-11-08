import { normalize } from './assistant.js';
import type { HomeState, Routine, TimerItem } from './types.js';

/**
 * Nova's extra skills, checked before the device parser:
 *   timers · alarms · reminders · announcements · weather · daily briefing · custom voice routines
 * Pure functions: they return what should happen; index.ts carries it out.
 */

export type Skill =
  | { kind: 'timer'; item: TimerItem; reply: string }
  | { kind: 'cancel'; what: TimerItem['kind'] | 'all'; reply?: string }
  | { kind: 'list'; what: TimerItem['kind'] | 'all' }
  | { kind: 'announce'; message: string }
  | { kind: 'weather' }
  | { kind: 'defineRoutine'; phrase: string; actions: string }
  | { kind: 'deleteRoutine'; phrase: string }
  | { kind: 'listRoutines' }
  | { kind: 'runRoutine'; routine: Routine };

let n = 0;
const id = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

const UNIT_MS: [RegExp, number][] = [[/^h(ou)?rs?$/, 3_600_000], [/^min(ute)?s?$/, 60_000], [/^sec(ond)?s?$/, 1000]];

/** "1 hour and 30 minutes" / "90 seconds" / "an hour" → ms */
export function parseDuration(c: string): number | undefined {
  let total = 0, found = false;
  for (const m of c.matchAll(/\b(\d+(?:\.\d+)?|an?|half an?)\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/g)) {
    const qty = /^half/.test(m[1]) ? 0.5 : /^an?$/.test(m[1]) ? 1 : Number(m[1]);
    const unit = UNIT_MS.find(([re]) => re.test(m[2]))?.[1];
    if (unit) { total += qty * unit; found = true; }
  }
  return found && total > 0 ? Math.round(total) : undefined;
}

/** "7", "7:30 pm", "19:45", "noon" → next time it happens (ms). Wake-up alarms assume morning. */
export function parseClock(c: string, now = new Date(), preferMorning = false): number | undefined {
  if (/\bnoon\b/.test(c)) return nextAt(12, 0, now);
  if (/\bmidnight\b/.test(c)) return nextAt(0, 0, now);
  const m = /\b(?:at|for|by)?\s*(\d{1,2})(?::|\.)?(\d{2})?\s*(a\.?m\.?|p\.?m\.?|in the morning|tonight|in the evening|this evening|in the afternoon)?(?![\d%°])/.exec(c);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return undefined;
  const mer = m[3] ?? '';
  if (/^p|tonight|evening|afternoon/.test(mer) && h < 12) h += 12;
  if (/^a|morning/.test(mer) && h === 12) h = 0;
  if (!mer && h <= 12 && !preferMorning) {
    // "remind me at 8": the next 8 o'clock, whether that's morning or evening
    const am = nextAt(h % 12, min, now), pm = nextAt((h % 12) + 12, min, now);
    return Math.min(am, pm);
  }
  return nextAt(h, min, now);
}

function nextAt(h: number, min: number, now: Date) {
  const d = new Date(now);
  d.setHours(h, min, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
export function fmtDuration(ms: number) {
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h && `${h} hour${h > 1 ? 's' : ''}`, m && `${m} minute${m > 1 ? 's' : ''}`, !h && sec && `${sec} second${sec > 1 ? 's' : ''}`].filter(Boolean).join(' and ') || '0 seconds';
}
const whenWords = (at: number) => {
  const d = new Date(at), today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const day = d.toDateString() === today.toDateString() ? 'today' : d.toDateString() === tomorrow.toDateString() ? 'tomorrow' : d.toLocaleDateString('en-CA', { weekday: 'long' });
  return `${fmtTime(at)} ${day}`;
};

const cleanPhrase = (s: string) => normalize(s).replace(/[,.!?'"“”]/g, '').replace(/\s+/g, ' ').trim();

export function matchSkill(raw: string, home: HomeState, by?: string, now = new Date()): Skill | undefined {
  const text = raw.trim();
  const c = normalize(text);
  const lower = text.toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

  // --- custom routines -------------------------------------------------------------------------
  const def = /^(?:(?:hey |ok |okay )?nova,?\s+)?(?:when(?:ever)? i say|if i say|create a routine called)\s+["']?(.+?)["']?\s*(?:,|then|that)\s*(.+)$/.exec(lower);
  if (def) return { kind: 'defineRoutine', phrase: cleanPhrase(def[1]), actions: def[2].trim() };
  const del = /\b(?:delete|remove|forget)\s+(?:the\s+|my\s+)?routine\s+(?:called\s+)?["']?(.+?)["']?$/.exec(lower);
  if (del) return { kind: 'deleteRoutine', phrase: cleanPhrase(del[1]) };
  if (/\b(what|which|list|show)\b.*\broutines?\b/.test(c)) return { kind: 'listRoutines' };
  const phrase = cleanPhrase(text);
  const routine = home.routines.find((r) => phrase === r.phrase || phrase === `nova ${r.phrase}`);
  if (routine) return { kind: 'runRoutine', routine };

  // --- announcements ---------------------------------------------------------------------------
  const ann = /^(?:(?:hey |ok |okay )?nova,?\s+)?(?:announce|broadcast|tell everyone|tell the house)\s+(?:that\s+)?(.+)$/i.exec(text);
  if (ann) return { kind: 'announce', message: ann[1].replace(/[.!]+$/, '') };

  // --- timers / alarms / reminders --------------------------------------------------------------
  const cancel = /\b(cancel|stop|delete|clear|turn off|dismiss)\b.*\b(timers?|alarms?|reminders?)\b/.exec(c);
  if (cancel) {
    const what = /timer/.test(cancel[2]) ? 'timer' : /alarm/.test(cancel[2]) ? 'alarm' : 'reminder';
    return { kind: 'cancel', what };
  }
  if (/\b(how (much|long)|what'?s left|time left|any|what|which|list|show)\b.*\b(timers?|alarms?|reminders?)\b/.test(c) && !parseDuration(c)) {
    const w = /timer/.test(c) ? 'timer' : /alarm/.test(c) ? 'alarm' : /reminder/.test(c) ? 'reminder' : 'all';
    return { kind: 'list', what: w };
  }

  const remind = /\bremind (?:me|us)\b\s*(.*)$/.exec(lower);
  if (remind) {
    let rest = normalize(remind[1]);
    let at: number | undefined;
    const inDur = /\bin\s+(.+?(?:hours?|hrs?|minutes?|mins?|seconds?|secs?))\b/.exec(rest);
    if (inDur) { const ms = parseDuration(inDur[1]); if (ms) { at = now.getTime() + ms; rest = rest.replace(inDur[0], ' '); } }
    if (!at) {
      const atM = /\b(?:at|by)\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|tonight|in the (?:morning|evening|afternoon))?|noon|midnight)/.exec(rest);
      if (atM) { at = parseClock(atM[0], now); rest = rest.replace(atM[0], ' '); }
      if (/\btomorrow\b/.test(rest) && at) { if (at - now.getTime() < 12 * 3_600_000) at += 86_400_000; rest = rest.replace(/\btomorrow\b/, ' '); }
    }
    const label = rest.replace(/^\s*(to|that|about)\s+/, '').replace(/\s+/g, ' ').trim().replace(/[.!?]$/, '');
    if (!at) return undefined;
    if (!label) return undefined;
    const item: TimerItem = { id: id(), kind: 'reminder', label, at, createdBy: by };
    return { kind: 'timer', item, reply: `Okay, I'll remind you to ${label} at ${whenWords(at)}.` };
  }

  if (/\b(wake me( up)?|alarm)\b/.test(c) && !/\b(security|burglar|smoke|fire|co)\b/.test(c)) {
    const inMs = /\bin\b/.test(c) ? parseDuration(c) : undefined;
    const at = inMs ? now.getTime() + inMs : parseClock(c, now, /\bwake\b/.test(c) || !/\b(pm|tonight|evening)\b/.test(c));
    if (!at) return undefined;
    const wake = /\bwake\b/.test(c);
    const item: TimerItem = { id: id(), kind: 'alarm', label: wake ? 'Wake up' : 'Alarm', at, createdBy: by, scene: wake ? 'morning' : undefined };
    return { kind: 'timer', item, reply: `Alarm set for ${whenWords(at)}.${wake ? ' I’ll open the blinds and run Good Morning when it goes off.' : ''}` };
  }

  if (/\btimer\b/.test(c)) {
    const ms = parseDuration(c);
    if (!ms) return undefined;
    const label = /\b(?:for|called)\s+(?:the\s+)?([a-z][a-z ]{1,24}?)\s*$/.exec(c.replace(/\b\d+.*?(hours?|minutes?|mins?|seconds?|secs?)\b/g, '').trim())?.[1]
      ?? /\b([a-z]+)\s+timer\b/.exec(c)?.[1]?.replace(/^(a|the|minute|second|hour|set)$/, '') ?? '';
    const trimmed = label.replace(/^(?:for|called)\s+/, '').trim();
    const name = trimmed && !/^(a|an|the|me|set|start)$/.test(trimmed) ? trimmed : '';
    const item: TimerItem = { id: id(), kind: 'timer', label: name || 'Timer', at: now.getTime() + ms, duration: ms, createdBy: by };
    return { kind: 'timer', item, reply: `${name ? `${name[0].toUpperCase()}${name.slice(1)} timer` : 'Timer'} set for ${fmtDuration(ms)}.` };
  }

  // --- weather ---------------------------------------------------------------------------------
  if (/\b(weather|forecast|umbrella|raining|rain today|snowing|snow today|outside temperature|(cold|warm|hot) (is it )?outside|temperature outside)\b/.test(c)) return { kind: 'weather' };

  return undefined;
}

export function describeTimers(items: TimerItem[], what: TimerItem['kind'] | 'all', now = Date.now()): string {
  const list = items.filter((t) => what === 'all' || t.kind === what).sort((a, b) => a.at - b.at);
  if (!list.length) return `You don't have any ${what === 'all' ? 'timers, alarms or reminders' : `${what}s`} set.`;
  return list.map((t) => t.kind === 'timer'
    ? `${t.label === 'Timer' ? 'Your timer' : `The ${t.label} timer`} has ${fmtDuration(Math.max(0, t.at - now))} left`
    : t.kind === 'alarm' ? `Alarm at ${whenWords(t.at)}` : `Reminder to ${t.label} at ${whenWords(t.at)}`).join('. ') + '.';
}
