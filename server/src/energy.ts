/**
 * Ontario Time-of-Use (TOU) electricity pricing + usage history.
 *
 * Rates are the Ontario Energy Board TOU prices (¢/kWh) and change once a year; override them with
 * TOU_OFF / TOU_MID / TOU_ON. Periods:
 *   weekends & holidays: off-peak all day
 *   weekdays 7 pm – 7 am: off-peak
 *   winter (Nov–Apr) weekdays: on-peak 7–11 am and 5–7 pm, mid-peak 11 am – 5 pm
 *   summer (May–Oct) weekdays: on-peak 11 am – 5 pm, mid-peak 7–11 am and 5–7 pm
 */

export type Period = 'off' | 'mid' | 'on';
export const RATES: Record<Period, number> = {
  off: Number(process.env.TOU_OFF ?? 7.6),
  mid: Number(process.env.TOU_MID ?? 12.2),
  on: Number(process.env.TOU_ON ?? 15.8),
};
export const PERIOD_NAME: Record<Period, string> = { off: 'Off-peak', mid: 'Mid-peak', on: 'On-peak' };

/** Ontario statutory holidays that are off-peak all day (fixed-date ones; good enough for a demo). */
const FIXED_HOLIDAYS = ['01-01', '07-01', '12-25', '12-26'];

export function periodAt(d = new Date()): Period {
  const day = d.getDay(), h = d.getHours();
  const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (day === 0 || day === 6 || FIXED_HOLIDAYS.includes(md)) return 'off';
  if (h < 7 || h >= 19) return 'off';
  const winter = d.getMonth() >= 10 || d.getMonth() <= 3;
  const peakHours = (h >= 7 && h < 11) || (h >= 17 && h < 19);
  return winter ? (peakHours ? 'on' : 'mid') : (peakHours ? 'mid' : 'on');
}

export const rateAt = (d = new Date()) => RATES[periodAt(d)];

/** Today's 24 hourly periods, for the TOU timeline. */
export function todaysPeriods(d = new Date()): Period[] {
  return Array.from({ length: 24 }, (_, h) => { const x = new Date(d); x.setHours(h, 30, 0, 0); return periodAt(x); });
}

/** When does the next off-peak stretch start? */
export function nextOffPeak(from = new Date()): Date {
  const d = new Date(from);
  d.setMinutes(0, 0, 0);
  for (let i = 0; i < 48; i++) {
    d.setHours(d.getHours() + 1);
    if (periodAt(d) === 'off') return d;
  }
  return d;
}

export interface UsageHour { hour: number; wh: number; cost: number } // cost in dollars

/** Adds `watts` for `seconds` to the right hourly bucket, priced at the TOU rate of that moment. */
export function addUsage(usage: UsageHour[], watts: number, seconds: number, now = new Date()): UsageHour[] {
  const hour = new Date(now); hour.setMinutes(0, 0, 0);
  const wh = (watts * seconds) / 3600;
  const cost = (wh / 1000) * (rateAt(now) / 100);
  const last = usage[usage.length - 1];
  if (last && last.hour === hour.getTime()) { last.wh += wh; last.cost += cost; }
  else usage.push({ hour: hour.getTime(), wh, cost });
  while (usage.length > 24 * 8) usage.shift(); // keep ~8 days
  return usage;
}

export function summary(usage: UsageHour[], now = new Date()) {
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = new Date(startOfDay); start.setDate(start.getDate() - (6 - i));
    const end = start.getTime() + 86_400_000;
    const hrs = usage.filter((u) => u.hour >= start.getTime() && u.hour < end);
    return { day: start.getTime(), kwh: hrs.reduce((s, u) => s + u.wh, 0) / 1000, cost: hrs.reduce((s, u) => s + u.cost, 0) };
  });
  const today = days[6];
  const week = days.reduce((s, d) => ({ kwh: s.kwh + d.kwh, cost: s.cost + d.cost }), { kwh: 0, cost: 0 });
  return { days, today, week };
}

/** A friendly money-saving tip based on the current TOU period. */
export function savingTip(now = new Date()): string {
  const p = periodAt(now);
  if (p === 'off') return `It's off-peak (${RATES.off}¢/kWh), the cheapest time: a great moment for the dishwasher, laundry or charging.`;
  const at = nextOffPeak(now);
  const when = at.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  const save = Math.round((1 - RATES.off / RATES[p]) * 100);
  return `It's ${PERIOD_NAME[p].toLowerCase()} right now (${RATES[p]}¢/kWh). Run the dishwasher or laundry after ${when} to save about ${save}%.`;
}
