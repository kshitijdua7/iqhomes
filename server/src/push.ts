import webpush, { type PushSubscription } from 'web-push';
import type { Role } from './types.js';

/**
 * Web Push: real notifications on phones and laptops, even when the app is closed.
 * VAPID keys are generated once and stored in server/data (git-ignored).
 */

export interface PushData {
  vapid: { publicKey: string; privateKey: string };
  subs: { userId: string; role: Role; sub: PushSubscription }[];
}

export interface Alert { title: string; body: string; tag?: string; url?: string }

export class Push {
  data: PushData;

  constructor(saved: Partial<PushData> | undefined, private onChange: () => void) {
    this.data = {
      vapid: saved?.vapid ?? webpush.generateVAPIDKeys(),
      subs: saved?.subs ?? [],
    };
    webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:admin@iqhomes.local', this.data.vapid.publicKey, this.data.vapid.privateKey);
    if (!saved?.vapid) onChange();
  }

  get publicKey() { return this.data.vapid.publicKey; }

  subscribe(userId: string, role: Role, sub: PushSubscription) {
    if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint)) return false;
    this.data.subs = this.data.subs.filter((s) => s.sub.endpoint !== sub.endpoint);
    this.data.subs.push({ userId, role, sub });
    this.onChange();
    return true;
  }

  unsubscribe(endpoint: string) {
    this.data.subs = this.data.subs.filter((s) => s.sub.endpoint !== endpoint);
    this.onChange();
  }

  /** Forget every device of a user (e.g. a revoked guest). */
  dropUser(userId: string) {
    const before = this.data.subs.length;
    this.data.subs = this.data.subs.filter((s) => s.userId !== userId);
    if (this.data.subs.length !== before) this.onChange();
  }

  /** Send to everyone whose role is in `roles`. Dead subscriptions (uninstalled app, revoked permission) are cleaned up. */
  async send(alert: Alert, roles: Role[] = ['owner', 'family']) {
    const targets = this.data.subs.filter((s) => roles.includes(s.role));
    const payload = JSON.stringify(alert);
    const dead: string[] = [];
    await Promise.all(targets.map(async ({ sub }) => {
      try { await webpush.sendNotification(sub, payload, { TTL: 3600, urgency: 'high' }); }
      catch (e) { if ([404, 410].includes((e as { statusCode?: number }).statusCode ?? 0)) dead.push(sub.endpoint); }
    }));
    if (dead.length) {
      this.data.subs = this.data.subs.filter((s) => !dead.includes(s.sub.endpoint));
      this.onChange();
    }
  }
}
