import mqtt from 'mqtt';
import type { Device, DevicePatch } from './types.js';

/**
 * Optional MQTT bridge (set MQTT_URL, e.g. mqtt://192.168.0.10:1883 or mqtts://user:pass@host).
 *
 *   iqhomes/<deviceId>/state   ← IQHomes publishes each device's state (retained JSON)
 *   iqhomes/<deviceId>/set     → send JSON changes, e.g. {"on":true,"brightness":40}
 *   iqhomes/status             ← "online" / "offline" (last will)
 *
 * Lights, plugs, fans, locks and sensors also announce themselves with Home Assistant MQTT discovery,
 * so they appear in Home Assistant automatically. An ESP32 running any MQTT library can drive or mirror them too.
 */
export class MqttBridge {
  private client?: mqtt.MqttClient;
  private last = new Map<string, string>();
  private prefix = process.env.MQTT_PREFIX ?? 'iqhomes';

  constructor(private devices: () => Device[], private onCommand: (patch: DevicePatch) => void, url = process.env.MQTT_URL) {
    if (!url) return;
    this.client = mqtt.connect(url, {
      clientId: `iqhomes-${Math.random().toString(16).slice(2, 8)}`,
      will: { topic: `${this.prefix}/status`, payload: Buffer.from('offline'), retain: true, qos: 1 },
      reconnectPeriod: 5000,
    });
    this.client.on('connect', () => {
      console.log(`📡 MQTT connected (${url.replace(/\/\/[^@]*@/, '//***@')})`);
      this.client!.publish(`${this.prefix}/status`, 'online', { retain: true });
      this.client!.subscribe(`${this.prefix}/+/set`);
      this.last.clear();
      this.discovery();
      this.publish();
    });
    this.client.on('error', (e) => console.error('MQTT error:', e.message));
    this.client.on('message', (topic, payload) => {
      const id = topic.slice(this.prefix.length + 1, -'/set'.length);
      try {
        const raw = payload.toString().trim();
        const changes = raw.startsWith('{') ? JSON.parse(raw) : { on: /^(on|true|1)$/i.test(raw) };
        if (changes && typeof changes === 'object') this.onCommand({ id, changes });
      } catch { /* ignore malformed */ }
    });
  }

  get enabled() { return !!this.client; }

  /** Publish devices whose state changed since last time. */
  publish() {
    if (!this.client?.connected) return;
    for (const d of this.devices()) {
      const { hardware: _h, integration: _i, watts, ...rest } = d;
      const json = JSON.stringify({ ...rest, watts, state: 'on' in d ? (d.on ? 'ON' : 'OFF') : undefined });
      if (this.last.get(d.id) === json) continue;
      this.last.set(d.id, json);
      this.client.publish(`${this.prefix}/${d.id}/state`, json, { retain: true });
    }
  }

  /** Home Assistant MQTT discovery for the device types it understands. */
  private discovery() {
    const base = { availability_topic: `${this.prefix}/status`, device: { identifiers: ['iqhomes'], name: 'IQHomes', manufacturer: 'IQHomes' } };
    for (const d of this.devices()) {
      const uid = `iqhomes_${d.id.replace(/[^a-z0-9_]/gi, '_')}`;
      const st = `${this.prefix}/${d.id}/state`, cmd = `${this.prefix}/${d.id}/set`;
      let component: string | undefined, cfg: Record<string, unknown> = {};
      if (d.type === 'light') {
        component = 'light';
        cfg = { schema: 'template', command_topic: cmd, state_topic: st,
          command_on_template: '{"on":true{% if brightness is defined %},"brightness":{{ (brightness / 2.55) | int }}{% endif %}}',
          command_off_template: '{"on":false}', state_template: '{{ value_json.state | lower }}',
          brightness_template: '{{ (value_json.brightness * 2.55) | int }}' };
      } else if (d.type === 'plug' || d.type === 'fan' || d.type === 'tv') {
        component = 'switch';
        cfg = { command_topic: cmd, state_topic: st, payload_on: '{"on":true}', payload_off: '{"on":false}', value_template: '{{ value_json.state }}', state_on: 'ON', state_off: 'OFF' };
      } else if (d.type === 'lock') {
        component = 'lock';
        cfg = { command_topic: cmd, state_topic: st, payload_lock: '{"locked":true}', payload_unlock: '{"locked":false}', value_template: '{{ "LOCKED" if value_json.locked else "UNLOCKED" }}' };
      } else if (d.type === 'sensor') {
        component = 'binary_sensor';
        cfg = { state_topic: st, value_template: '{{ "ON" if value_json.triggered else "OFF" }}',
          device_class: { motion: 'motion', contact: 'door', smoke: 'smoke', co: 'carbon_monoxide', leak: 'moisture' }[d.kind] };
      }
      if (component) this.client!.publish(`homeassistant/${component}/${uid}/config`, JSON.stringify({ ...base, ...cfg, name: d.name, unique_id: uid }), { retain: true });
    }
  }
}
