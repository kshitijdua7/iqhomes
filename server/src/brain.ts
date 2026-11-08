import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { DevicePatch, HomeState } from './types.js';

/**
 * Nova's AI brain: used only when the built-in parser doesn't understand a sentence.
 * Claude gets the house (devices + rooms + scenes) and the recent conversation, and returns structured actions.
 * Every action still goes through the normal sanitizers and permission checks, so the AI can't do anything
 * the person couldn't do by tapping.
 *
 * Off unless ANTHROPIC_API_KEY is set (each request costs a small amount).
 */

const MODEL = process.env.NOVA_AI_MODEL ?? 'claude-opus-5-5';

const Action = z.object({
  device_id: z.string().describe('Exact id of a device from the house list'),
  on: z.boolean().nullable(),
  brightness: z.number().int().nullable().describe('1-100'),
  color: z.string().nullable().describe('#rrggbb'),
  position: z.number().int().nullable().describe('Blinds: 0 closed - 100 open'),
  target: z.number().nullable().describe('Thermostat target °C, 10-30'),
  mode: z.enum(['heat', 'cool', 'auto', 'off']).nullable(),
  locked: z.boolean().nullable(),
  speed: z.number().int().nullable().describe('Fan 1-3'),
  volume: z.number().int().nullable().describe('TV 0-100'),
  open: z.boolean().nullable().describe('Garage door'),
});

const Reply = z.object({
  reply: z.string().describe('What Nova says out loud: one or two short, friendly sentences'),
  actions: z.array(Action),
  scenes: z.array(z.string()).describe('Scene ids to run, if any'),
});

const SYSTEM = `You are Nova, the voice assistant of a smart home app called IQHomes. You run on a wall tablet and phones.
Turn what the person says into device actions, and reply like a warm, concise voice assistant (it will be spoken aloud).

Rules:
- Only use device ids and scene ids from the house snapshot. Never invent devices.
- Only set the fields that should change; leave the others null.
- Use the conversation to resolve "it", "them", "a bit more", "too bright", "the other one", etc.
  "A bit" means about 10-20% for brightness/volume/blinds, or 1° for temperature.
- If the request is a question, answer it from the snapshot with no actions.
- If you can't do something (no such device), say so briefly and suggest the closest thing you can do.
- Never unlock doors or open the garage unless the person clearly asked for exactly that.
- Keep replies short: no lists, no markdown, no emoji.`;

type Turn = { role: 'user' | 'assistant'; content: string };
const memory = new Map<string, Turn[]>(); // per person, last few turns
const MAX_TURNS = 10;

let client: Anthropic | undefined;
export const aiEnabled = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/** Remember turns the built-in parser handled too, so "turn it up a bit more" works after a regular command. */
export function remember(person: string, user: string, reply: string) {
  const turns = memory.get(person) ?? [];
  turns.push({ role: 'user', content: user }, { role: 'assistant', content: reply });
  memory.set(person, turns.slice(-MAX_TURNS));
}

function snapshot(home: HomeState) {
  return JSON.stringify({
    rooms: home.rooms.map((r) => ({ id: r.id, name: r.name })),
    scenes: home.scenes.map((s) => ({ id: s.id, name: s.name, does: s.description })),
    devices: home.devices.map(({ watts: _w, hardware: _h, integration: _i, ...d }) => d),
    outside: home.weather ? `${home.weather.temp}°C, ${home.weather.condition}` : `${home.outsideTemp}°C`,
    time: new Date().toLocaleString('en-CA', { weekday: 'long', hour: 'numeric', minute: '2-digit' }),
  });
}

export async function askBrain(person: string, text: string, home: HomeState, lang: 'en' | 'fr' = 'en'):
  Promise<{ reply: string; patches: DevicePatch[]; scenes: string[] } | undefined> {
  if (!aiEnabled()) return undefined;
  client ??= new Anthropic();
  const history = memory.get(person) ?? [];
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history,
    {
      role: 'user',
      content: `House snapshot:\n${snapshot(home)}\n\n${lang === 'fr' ? 'Reply in French (Canadian). ' : ''}${person} says: "${text}"`,
    },
  ];

  try {
    const response = await client.beta.messages.parse({
      model: MODEL,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // if Opus declines, the API retries on a suitable fallback model in the same call
      max_tokens: 16000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low', format: zodOutputFormat(Reply) },
      messages,
    });
    if (response.stop_reason === 'refusal') return { reply: "Sorry, I can't help with that one.", patches: [], scenes: [] };
    const out = response.parsed_output;
    if (!out) return undefined;

    const patches: DevicePatch[] = out.actions
      .filter((a) => home.devices.some((d) => d.id === a.device_id))
      .map(({ device_id, ...fields }) => ({
        id: device_id,
        changes: Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null)),
      }))
      .filter((p) => Object.keys(p.changes).length > 0);
    const scenes = out.scenes.filter((s) => home.scenes.some((x) => x.id === s));
    remember(person, text, out.reply);
    return { reply: out.reply, patches, scenes };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) console.error('Nova AI: the ANTHROPIC_API_KEY was rejected.');
    else if (e instanceof Anthropic.RateLimitError) console.error('Nova AI: rate limited, falling back to the built-in parser.');
    else if (e instanceof Anthropic.APIError) console.error(`Nova AI: API error ${e.status}: ${e.message}`);
    else console.error('Nova AI error:', e);
    return undefined;
  }
}
