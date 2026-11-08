/**
 * A pretend ESP32 that speaks exactly the same protocol as the real sketch in /hardware/esp32-iqhomes.
 * Lets you demo (and test) the hardware bridge with no board plugged in.
 *
 *   npm run fake-esp32 --prefix server
 *
 * Press ENTER to "press the physical button". Ctrl+C to unplug it.
 * Env: SERVER=ws://localhost:4000  DEVICE=living-lamp  TOKEN=<from server/data/hardware.json>
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import WebSocket from 'ws';

const here = dirname(fileURLToPath(import.meta.url));
const token = process.env.TOKEN ?? JSON.parse(readFileSync(join(here, '..', 'data', 'hardware.json'), 'utf8')).token;
const server = process.env.SERVER ?? 'ws://localhost:4000';
const device = process.env.DEVICE ?? 'living-lamp';

let on = false;
let tempC = 23.5;

function connect() {
  const ws = new WebSocket(`${server}/hardware?token=${encodeURIComponent(token)}`);
  let telemetry: NodeJS.Timeout;

  ws.on('open', () => {
    console.log(`🔌 Fake ESP32 connected, controlling "${device}". Press ENTER to press the button.`);
    ws.send(JSON.stringify({ type: 'hello', device, fw: 'fake-1.0' }));
    telemetry = setInterval(() => {
      tempC = Math.round((tempC + (Math.random() - 0.5) * 0.3) * 10) / 10;
      ws.send(JSON.stringify({ type: 'telemetry', tempC, rssi: -50 - Math.round(Math.random() * 15) }));
    }, 5000);
  });

  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.type === 'state') {
      on = Boolean(msg.on);
      const bar = on ? '█'.repeat(Math.round((msg.brightness ?? 100) / 10)).padEnd(10, '░') : '░░░░░░░░░░';
      console.log(`💡 LED ${on ? 'ON ' : 'OFF'} ${bar} ${on ? `${msg.brightness ?? 100}%` : ''} ${msg.color ?? ''}`);
    } else if (msg.type === 'error') console.error('❌', msg.error);
  });

  ws.on('close', (code) => {
    clearInterval(telemetry);
    console.log(code === 1006 ? '…server unreachable, retrying in 3s' : `connection closed (${code}), retrying in 3s`);
    setTimeout(connect, 3000);
  });
  ws.on('error', () => {});

  return ws;
}

let ws = connect();
createInterface({ input: process.stdin }).on('line', () => {
  if (ws.readyState !== ws.OPEN) { ws = connect(); return; }
  console.log('🔘 button pressed');
  ws.send(JSON.stringify({ type: 'button' }));
});
