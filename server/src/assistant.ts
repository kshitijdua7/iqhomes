/**
 * Nova's brain: turns a spoken or typed sentence into device changes.
 *
 * It's a rule-based natural-language parser, so it runs instantly, works offline and costs nothing.
 * Flow:  normalize text → split into clauses ("... and ...") → for each clause find
 *        ACTION (on/off/dim/open/...), ROOM, DEVICE TYPE and NUMBER → build patches → write a reply.
 * Clauses remember the previous clause's room and action, so
 * "dim the living room to 30% and close the blinds" closes the LIVING ROOM blinds.
 */
import type { Device, DevicePatch, DeviceType, HomeState } from './types.js';

export interface AssistantResult {
  understood: boolean;
  reply: string;
  patches: DevicePatch[];
  scenes: string[];
}

type Action =
  | 'on' | 'off' | 'toggle' | 'dim' | 'brighten' | 'set' | 'open' | 'close'
  | 'lock' | 'unlock' | 'warmer' | 'cooler' | 'color' | 'louder' | 'quieter' | 'faster' | 'slower';

const ROOM_WORDS: [RegExp, string][] = [
  [/\b(living ?room|lounge|family room|living)\b/, 'living'],
  [/\bkitchen\b/, 'kitchen'],
  [/\b(bed ?room|master)\b/, 'bedroom'],
  [/\b(office|study|work ?room)\b/, 'office'],
  [/\b(entrance|entry|porch|front|hallway|hall|outside)\b/, 'entrance'],
];

const TYPE_WORDS: [RegExp, DeviceType][] = [
  [/\bgarage( doors?)?\b/, 'garage'], // before locks, so "garage door" isn't the front door
  [/\b(lights?|lamps?|lighting|bulbs?)\b/, 'light'],
  [/\b(blinds?|shades?|curtains?|shutters?|windows?)\b/, 'blinds'],
  [/\b(thermostat|temperature|heat(ing)?|ac|air ?con(ditioning)?|degrees)\b/, 'thermostat'],
  [/\b(locks?|doors?|deadbolt)\b/, 'lock'],
  [/\b(fans?)\b/, 'fan'],
  [/\b(tv|television|telly)\b/, 'tv'],
  [/\b(plugs?|outlets?|sockets?|coffee( maker)?|monitors?|computer)\b/, 'plug'],
];

/** Phrases that point at one exact device. */
const DEVICE_ALIASES: [RegExp, string][] = [
  [/\bfloor lamp\b/, 'living-lamp'],
  [/\bceiling light\b/, 'living-main'],
  [/\bporch light\b/, 'entrance-light'],
  [/\bdesk (light|lamp)\b/, 'office-desk'],
  [/\bcoffee( maker| machine)?\b/, 'kitchen-coffee'],
  [/\b(monitors?|computer)\b/, 'office-plug'],
  [/\b(ceiling )?fan\b/, 'bedroom-fan'],
  [/\b(tv|television|telly)\b/, 'living-tv'],
  [/\b(?<!garage )(front )?door\b/, 'front-door'],
];

const SCENE_WORDS: [RegExp, string][] = [
  [/\b(movie (night|time|mode)|netflix|cinema mode)\b/, 'movie'],
  [/\b(good ?morning|wake up|morning mode|i'?m up)\b/, 'morning'],
  [/\b(good ?night|bed ?time|going to (bed|sleep)|night mode)\b/, 'night'],
  [/\b(away mode|i'?m (leaving|heading out|going out)|leaving (now|home)|nobody'?s home)\b/, 'away'],
  [/\b(focus( mode)?|work mode|study mode)\b/, 'focus'],
];

const COLORS: Record<string, string> = {
  red: '#ff4d4d', orange: '#ff9f43', yellow: '#ffe066', green: '#4cd97b', teal: '#2ed3c6',
  blue: '#4d8dff', purple: '#9b6bff', violet: '#9b6bff', pink: '#ff6fb5', white: '#ffffff',
  'warm white': '#ffd9a0', warm: '#ffc68a', cool: '#e6f0ff', 'cool white': '#e6f0ff', gold: '#ffc94d',
};

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, 'twenty one': 21,
  'twenty two': 22, 'twenty three': 23, 'twenty four': 24, 'twenty five': 25, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, 'a hundred': 100, half: 50, halfway: 50,
};

export function normalize(text: string): string {
  let t = ` ${text.toLowerCase()} `
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9%°#' ,.:-]/g, ' ')
    .replace(/\b(hey |ok |okay )?nova\b/g, ' ')
    .replace(/\b(please|could you|can you|would you|i want you to|i'd like you to|for me|kindly)\b/g, ' ');
  // longest number words first so "twenty two" beats "twenty"
  for (const w of Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length)) {
    t = t.replace(new RegExp(`\\b${w}\\b`, 'g'), String(NUMBER_WORDS[w]));
  }
  return t.replace(/\s+/g, ' ').trim();
}

function findAction(c: string): Action | undefined {
  if (/\bunlock\b/.test(c)) return 'unlock';
  if (/\block\b/.test(c)) return 'lock';
  if (/\b(warmer|heat (it )?up|i'?m (cold|freezing)|too cold|turn up the (heat|temperature))\b/.test(c)) return 'warmer';
  if (/\b(cooler|colder|cool (it )?down|i'?m (hot|warm|boiling)|too (hot|warm)|turn down the (heat|temperature))\b/.test(c)) return 'cooler';
  if (/\b(louder|volume up|turn (it )?up)\b/.test(c)) return 'louder';
  if (/\b(quieter|volume down|turn (it )?down|softer)\b/.test(c)) return 'quieter';
  if (/\bfaster\b/.test(c)) return 'faster';
  if (/\bslower\b/.test(c)) return 'slower';
  if (/\b(dim|darker|lower the light)/.test(c)) return 'dim';
  if (/\b(brighten|brighter|full brightness|max(imum)? brightness)\b/.test(c)) return 'brighten';
  if (/\b(open|raise|let (the )?(sun|light) in)\b/.test(c)) return 'open';
  if (/\b(close|shut|lower)\b/.test(c)) return 'close';
  if (/\b(turn off|switch off|shut off|power off|kill|turn .+ off|switch .+ off|stop)\b/.test(c) || /\boff\b/.test(c)) return 'off';
  if (/\b(turn on|switch on|power on|turn .+ on|switch .+ on|start|make (some )?coffee|brew)\b/.test(c) || /\bon\b/.test(c)) return 'on';
  if (/\btoggle\b/.test(c)) return 'toggle';
  if (Object.keys(COLORS).some((name) => new RegExp(`\\b${name}\\b`).test(c)) && /\b(make|change|turn|set|color|colour)\b/.test(c)) return 'color';
  if (/\b(set|make|change|put|turn|adjust)\b/.test(c) && /\d/.test(c)) return 'set';
  return undefined;
}

const findRoom = (c: string) => ROOM_WORDS.find(([re]) => re.test(c))?.[1];
const findType = (c: string) => TYPE_WORDS.find(([re]) => re.test(c))?.[1];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Devices added from the app (real switches) are matched by their own name first, longest name wins. */
const findDevice = (c: string, home: HomeState) => {
  const named = home.devices
    .filter((d) => (d.integration || d.custom) && normalize(d.name).length > 1)
    .sort((a, b) => b.name.length - a.name.length)
    .find((d) => new RegExp(`\\b${escapeRe(normalize(d.name))}s?\\b`).test(c));
  return named?.id ?? DEVICE_ALIASES.find(([re]) => re.test(c))?.[1];
};
const findColor = (c: string) =>
  Object.keys(COLORS).sort((a, b) => b.length - a.length).find((name) => new RegExp(`\\b${name}\\b`).test(c));
function findNumber(c: string): number | undefined {
  const m = c.match(/(-?\d+(\.\d+)?)/);
  return m ? Number(m[1]) : undefined;
}
const isEverything = (c: string) => /\b(everything|all devices|whole house|entire house|all the things)\b/.test(c);
const isAllLights = (c: string) => /\b(all( the)? lights|every light|lights everywhere|all lamps)\b/.test(c);

/** Questions Nova can answer without changing anything. */
function answerQuestion(c: string, home: HomeState): string | undefined {
  const t = home.devices.find((d) => d.type === 'thermostat');
  const lights = home.devices.filter((d) => d.type === 'light');
  if (/\b(what'?s|what is|how)\b.*\b(temperature|warm|cold|hot)\b/.test(c) && t?.type === 'thermostat')
    return `It's ${t.current}° inside, heading to ${t.target}°. Outside it's about ${home.outsideTemp}°.`;
  if (/\bgarage\b/.test(c) && /\b(is|are|did|was)\b/.test(c)) {
    const gs = home.devices.filter((d) => d.type === 'garage');
    if (!gs.length) return "You don't have a garage door connected yet.";
    return gs.map((d) => d.type === 'garage' && `The ${d.name.toLowerCase()} is ${d.moving ?? (d.open ? 'open' : 'closed')}.`).join(' ');
  }
  if (/\b(is|are)\b.*\b(door|locked|lock)\b/.test(c)) {
    const locks = home.devices.filter((d) => d.type === 'lock');
    const open = locks.filter((d) => d.type === 'lock' && !d.locked);
    return open.length ? `Heads up: ${open.map((d) => d.name).join(', ')} is unlocked.` : 'Yes, every door is locked.';
  }
  if (/\b(which|what|any)\b.*\blights?\b.*\bon\b/.test(c) || /\bwhat'?s on\b/.test(c)) {
    const on = lights.filter((d) => d.type === 'light' && d.on);
    return on.length ? `${on.length} light${on.length > 1 ? 's are' : ' is'} on: ${on.map((d) => d.name).join(', ')}.` : 'All the lights are off.';
  }
  if (/\b(cheap(est)?|price|rate|peak|time of use|tou)\b/.test(c) && /\b(power|electricity|energy|hydro|rate|price|peak|dishwasher|laundry|cheap(est)?)\b/.test(c)) {
    return home.tou?.tip ?? 'I don’t have electricity prices right now.';
  }
  if (/\b(how much|what)\b.*\b(use|used|spend|spent|cost)\b.*\b(today|this week|week|yesterday)\b/.test(c) && home.usage) {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const since = /week/.test(c) ? dayStart.getTime() - 6 * 86_400_000 : /yesterday/.test(c) ? dayStart.getTime() - 86_400_000 : dayStart.getTime();
    const until = /yesterday/.test(c) ? dayStart.getTime() : Infinity;
    const hrs = home.usage.filter((u) => u.hour >= since && u.hour < until);
    const kwh = hrs.reduce((s2, u) => s2 + u.wh, 0) / 1000, cost = hrs.reduce((s2, u) => s2 + u.cost, 0);
    const when = /week/.test(c) ? 'this week' : /yesterday/.test(c) ? 'yesterday' : 'today';
    return `${when[0].toUpperCase()}${when.slice(1)} the house has used ${kwh.toFixed(1)} kWh, about $${cost.toFixed(2)} at time-of-use rates.`;
  }
  if (/\b(power|energy|electricity|watts|usage|consumption)\b/.test(c)) {
    const total = Math.round(home.devices.reduce((s, d) => s + d.watts, 0));
    const top = [...home.devices].sort((a, b) => b.watts - a.watts)[0];
    const cents = home.tou?.cents ?? 13;
    const perHour = ((total / 1000) * (cents / 100)).toFixed(2);
    const period = home.tou ? ` at the ${home.tou.period === 'off' ? 'off-peak' : home.tou.period === 'mid' ? 'mid-peak' : 'on-peak'} rate of ${cents}¢` : '';
    return `The house is using ${total} watts right now, about $${perHour} an hour${period}. Biggest draw: ${top.name}.`;
  }
  if (/\bwhat time\b|\bthe time\b/.test(c)) return `It's ${new Date().toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}.`;
  if (/\b(who are you|your name|what are you)\b/.test(c)) return "I'm Nova, your home assistant. I control your lights, blinds, climate, locks and more.";
  if (/\b(help|what can you do|commands)\b/.test(c))
    return 'Try: "dim the living room to 30 percent and close the blinds", "set the temperature to 22", "lock the front door", "movie night", or "how much power are we using?"';
  if (/\b(joke|funny)\b/.test(c)) return 'Why did the smart bulb break up with the switch? It felt like it was always being turned off.';
  if (/^(hi|hello|hey|yo|good (afternoon|evening))\b/.test(c)) return 'Hey! What can I do for you?';
  if (/\b(thank|thanks|cheers)\b/.test(c)) return 'Anytime.';
  return undefined;
}

function pickTargets(home: HomeState, room?: string, type?: DeviceType, deviceId?: string, everything = false): Device[] {
  if (deviceId) return home.devices.filter((d) => d.id === deviceId);
  if (everything) return home.devices.filter((d) => ['light', 'tv', 'fan', 'plug'].includes(d.type));
  return home.devices.filter((d) => (!type || d.type === type) && (!room || d.room === room));
}

const roomName = (home: HomeState, id?: string) => home.rooms.find((r) => r.id === id)?.name.toLowerCase();
const where = (home: HomeState, room?: string) => (room ? ` in the ${roomName(home, room)}` : '');

export function interpret(text: string, home: HomeState): AssistantResult {
  const clean = normalize(text);
  if (!clean) return { understood: false, reply: "I didn't catch that.", patches: [], scenes: [] };

  const question = answerQuestion(clean, home);
  if (question && !findAction(clean.replace(/\bon\b/g, ''))) return { understood: true, reply: question, patches: [], scenes: [] };
  // "is the garage open?" contains "open" but is a question. Never let it move the door.
  if (question && /\bgarage\b/.test(clean) && /^(is|are|did|was|has)\b/.test(clean)) return { understood: true, reply: question, patches: [], scenes: [] };

  const clauses = clean.split(/\s*(?:,|\band then\b|\bthen\b|\band\b|\balso\b)\s*/).filter(Boolean);
  const patches: DevicePatch[] = [];
  const scenes: string[] = [];
  const replies: string[] = [];
  let lastRoom: string | undefined;
  let lastAction: Action | undefined;
  let lastType: DeviceType | undefined;

  for (const c of clauses) {
    const scene = SCENE_WORDS.find(([re]) => re.test(c))?.[1];
    if (scene) {
      scenes.push(scene);
      const s = home.scenes.find((x) => x.id === scene)!;
      replies.push(`${s.name} is on`);
      continue;
    }

    const explicitRoom = findRoom(c) ?? home.rooms
      .filter((r) => !ROOM_WORDS.some(([, id]) => id === r.id))
      .sort((a, b) => b.name.length - a.name.length)
      .find((r) => new RegExp(`\\b${escapeRe(normalize(r.name))}\\b`).test(c))?.id;
    const deviceId = findDevice(c, home);
    let type = findType(c);
    let action = findAction(c);
    const num = findNumber(c);
    const everything = isEverything(c);
    const allLights = isAllLights(c);

    // Fill gaps from context
    if (!action && (type || explicitRoom || deviceId)) action = lastAction;
    if (!action) continue;
    if (!type && !deviceId) {
      if (['open', 'close'].includes(action)) type = 'blinds';
      else if (['warmer', 'cooler'].includes(action) || (action === 'set' && num !== undefined && num >= 10 && num <= 30 && /degree|°|temp/.test(c))) type = 'thermostat';
      else if (['lock', 'unlock'].includes(action)) type = 'lock';
      else if (['dim', 'brighten', 'color'].includes(action)) type = 'light';
      else if (['louder', 'quieter'].includes(action)) type = 'tv';
      else if (['faster', 'slower'].includes(action)) type = 'fan';
      else if (['on', 'off', 'toggle', 'set'].includes(action) && !everything) type = lastType ?? 'light';
    }
    // "everything" / "all lights" apply house-wide; otherwise inherit the room from the previous clause
    const room = allLights || everything || type === 'thermostat' || type === 'lock' || type === 'garage' ? explicitRoom : explicitRoom ?? lastRoom;
    if (allLights) type = 'light';

    const targets = pickTargets(home, room, type, deviceId, everything && !allLights);
    if (!targets.length) {
      replies.push(`I couldn't find ${type ? `any ${type === 'light' ? 'lights' : type}` : 'that device'}${where(home, room)}`);
      continue;
    }

    const add = (d: Device, changes: Record<string, unknown>) => patches.push({ id: d.id, changes });
    const label = deviceId ? targets[0].name.toLowerCase() : type === 'garage' ? (targets.length === 1 ? targets[0].name.toLowerCase() : 'garage doors') : `${type === 'light' ? 'lights' : type === 'blinds' ? 'blinds' : type ?? 'devices'}${where(home, room)}`;

    switch (action) {
      case 'on': {
        // "turn on the bedroom lights at 40%" also sets brightness
        const extra = num !== undefined && type === 'light' ? { brightness: num } : {};
        targets.forEach((d) => add(d, { on: true, ...extra }));
        replies.push(`Turned on the ${everything ? 'house' : label}${num !== undefined && type === 'light' ? ` at ${num}%` : ''}`); break;
      }
      case 'off': targets.forEach((d) => add(d, { on: false })); replies.push(`Turned off ${everything ? 'everything' : `the ${label}`}`); break;
      case 'toggle': targets.forEach((d) => add(d, { on: !('on' in d && d.on) })); replies.push(`Toggled the ${label}`); break;
      case 'dim': {
        const level = num ?? 30;
        targets.forEach((d) => add(d, { on: true, brightness: level }));
        replies.push(`Dimmed the ${label} to ${level}%`); break;
      }
      case 'brighten': {
        const level = num ?? 100;
        targets.forEach((d) => add(d, { on: true, brightness: level }));
        replies.push(`Brightened the ${label} to ${level}%`); break;
      }
      case 'color': {
        const name = findColor(c)!;
        targets.forEach((d) => add(d, { on: true, color: COLORS[name] }));
        replies.push(`Made the ${label} ${name}`); break;
      }
      case 'open': {
        if (targets.some((d) => d.type === 'garage')) {
          targets.filter((d) => d.type === 'garage').forEach((d) => add(d, { open: true }));
          replies.push(`Opening the ${label}`); break;
        }
        const pos = num ?? 100;
        targets.forEach((d) => add(d, { position: pos }));
        replies.push(pos === 100 ? `Opened the ${label}` : `Opened the ${label} to ${pos}%`); break;
      }
      case 'close': {
        if (targets.some((d) => d.type === 'garage')) {
          targets.filter((d) => d.type === 'garage').forEach((d) => add(d, { open: false }));
          replies.push(`Closing the ${label}`); break;
        }
        const pos = /half/.test(c) ? 50 : num !== undefined ? 100 - num : 0;
        targets.forEach((d) => add(d, { position: pos }));
        replies.push(pos === 0 ? `Closed the ${label}` : `Closed the ${label} to ${pos}% open`); break;
      }
      case 'lock': targets.forEach((d) => add(d, { locked: true })); replies.push(`Locked the ${deviceId ? label : 'doors'}`); break;
      case 'unlock': targets.forEach((d) => add(d, { locked: false })); replies.push(`Unlocked the ${deviceId ? label : 'front door'}`); break;
      case 'warmer':
      case 'cooler': {
        const t = targets.find((d) => d.type === 'thermostat');
        if (t?.type !== 'thermostat') break;
        const delta = num !== undefined && num < 6 ? num : /\b(freezing|boiling)\b/.test(c) ? 3 : 2;
        const target = action === 'warmer' ? t.target + delta : t.target - delta;
        add(t, { target, mode: 'auto' });
        replies.push(`Setting the heat to ${Math.min(30, Math.max(10, target))}°`); break;
      }
      case 'louder':
      case 'quieter': {
        targets.filter((d) => d.type === 'tv').forEach((d) => {
          if (d.type !== 'tv') return;
          const volume = num ?? d.volume + (action === 'louder' ? 10 : -10);
          add(d, { on: true, volume });
          replies.push(`TV volume ${Math.min(100, Math.max(0, volume))}`);
        });
        break;
      }
      case 'faster':
      case 'slower': {
        targets.filter((d) => d.type === 'fan').forEach((d) => {
          if (d.type !== 'fan') return;
          add(d, { on: true, speed: d.speed + (action === 'faster' ? 1 : -1) });
        });
        replies.push(`Fan ${action === 'faster' ? 'sped up' : 'slowed down'}`); break;
      }
      case 'set': {
        if (num === undefined) break;
        for (const d of targets) {
          if (d.type === 'thermostat') { add(d, { target: num }); replies.push(`Temperature set to ${Math.min(30, Math.max(10, num))}°`); }
          else if (d.type === 'light') add(d, { on: true, brightness: num });
          else if (d.type === 'blinds') add(d, { position: num });
          else if (d.type === 'tv') add(d, { on: true, volume: num });
          else if (d.type === 'fan') add(d, { on: true, speed: num });
        }
        if (type === 'light') replies.push(`Set the ${label} to ${num}%`);
        if (type === 'blinds') replies.push(`Set the ${label} to ${num}% open`);
        break;
      }
    }
    lastAction = action;
    lastRoom = room;
    lastType = type;
  }

  if (!patches.length && !scenes.length) {
    if (question) return { understood: true, reply: question, patches: [], scenes: [] };
    if (replies.length) return { understood: false, reply: `${replies.join('. ')}.`, patches: [], scenes: [] };
    return { understood: false, reply: `Sorry, I'm not sure how to do "${text.trim()}" yet. Say "help" to hear what I can do.`, patches: [], scenes: [] };
  }

  const sentence = replies.map((r, i) => (i === 0 ? r : r.charAt(0).toLowerCase() + r.slice(1))).join(', and ');
  return { understood: true, reply: `${sentence}.`, patches, scenes };
}
