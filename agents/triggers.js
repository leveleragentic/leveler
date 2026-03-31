const EventEmitter = require('events');
const { clipboard } = require('electron');

class TriggerManager extends EventEmitter {
  constructor(config) {
    super();
    this.config    = config;
    this.triggers  = new Map();   // id → trigger
    this.timers    = new Map();   // id → timer handle
    this.running   = false;
    this.lastClip  = '';
    this.clipTimer = null;
    this.lastFired = new Map();   // id → last fire timestamp (rate limiting)
    this.backoff   = new Map();   // id → { count, until } (IMAP backoff)

    (config.triggers || []).forEach(t => this.add(t));
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────
  async start() {
    this.running = true;
    this._startClipboardMonitor();
    this.triggers.forEach(t => {
      if (t.enabled && t.type === 'email') this._startEmailPoller(t);
    });
    this._log('info', 'Trigger listeners active');
  }

  async stop() {
    this.running = false;
    if (this.clipTimer) { clearInterval(this.clipTimer); this.clipTimer = null; }
    this.timers.forEach(h => clearInterval(h));
    this.timers.clear();
    this._log('info', 'Trigger listeners stopped');
  }

  // ── Clipboard monitor (keyword triggers) ────────────────────────────────
  _startClipboardMonitor() {
    this.clipTimer = setInterval(() => {
      try {
        const text = clipboard.readText();
        if (text && text !== this.lastClip && text.trim().length > 3) {
          this.lastClip = text;
          this._checkKeywords(text, 'clipboard');
        }
      } catch (_) {}
    }, 1500);
  }

  // Keyword match: plain substring OR /regex/flags syntax
  _matchesKeyword(text, lower, kw) {
    if (!kw) return false;
    const reParts = kw.match(/^\/(.+)\/([gimy]*)$/);
    if (reParts) {
      try { return new RegExp(reParts[1], reParts[2]).test(text); } catch { return false; }
    }
    return lower.includes(kw.toLowerCase());
  }

  _checkKeywords(text, source) {
    const lower = text.toLowerCase();
    const now   = Date.now();
    this.triggers.forEach(trigger => {
      if (!trigger.enabled || trigger.type !== 'keyword') return;
      const match = (trigger.keywords || []).find(kw => this._matchesKeyword(text, lower, kw));
      if (!match) return;

      // Per-trigger cooldown (default 30s) to prevent spam
      const cooldownMs = (trigger.cooldownSec ?? 30) * 1000;
      const lastFire   = this.lastFired.get(trigger.id) || 0;
      if (now - lastFire < cooldownMs) return;
      this.lastFired.set(trigger.id, now);

      this._log('trigger', `Keyword hit: "${match}" via ${source}`);
      this.emit('triggered', trigger, {
        source,
        text: text.slice(0, 800),
        matchedKeyword: match,
      });
    });
  }

  // ── Email poller ────────────────────────────────────────────────────────
  _startEmailPoller(trigger) {
    const ms = (trigger.pollIntervalSec || 120) * 1000;
    // Initial poll after 5s, then on interval
    const doIt = () => this._pollEmail(trigger);
    setTimeout(doIt, 5000);
    const h = setInterval(doIt, ms);
    this.timers.set(trigger.id, h);
  }

  async _pollEmail(trigger) {
    if (!this.running) return;
    const cfg = trigger.emailConfig;
    if (!cfg?.host || !cfg?.user || !cfg?.pass) {
      this._log('warn', `Email trigger "${trigger.name}": IMAP config missing`);
      return;
    }

    // Exponential backoff: skip poll if still within backoff window
    const bo = this.backoff.get(trigger.id) || { count: 0, until: 0 };
    if (Date.now() < bo.until) {
      const remaining = Math.ceil((bo.until - Date.now()) / 1000);
      this._log('info', `Email trigger "${trigger.name}": backing off (${remaining}s remaining)`);
      return;
    }

    this._log('info', `Polling email for trigger: ${trigger.name}`);
    try {
      const { ImapFlow } = require('imapflow');
      const client = new ImapFlow({
        host: cfg.host, port: cfg.port || 993, secure: true,
        auth: { user: cfg.user, pass: cfg.pass },
        logger: false,
      });

      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      const results = [];

      try {
        const since = new Date(Date.now() - (trigger.pollIntervalSec || 120) * 2 * 1000);
        for await (const msg of client.fetch(
          { unseen: true, since },
          { envelope: true }
        )) {
          const subject = msg.envelope?.subject || '';
          const from    = msg.envelope?.from?.[0]?.address || '';
          const text    = `${subject} ${from}`.toLowerCase();

          const kws = trigger.keywords || [];
          const hit = kws.length === 0 || kws.find(k => k && text.includes(k.toLowerCase()));
          if (hit) results.push({ subject, from, date: msg.envelope?.date });
        }
      } finally {
        lock.release();
        await client.logout();
      }

      // Success — clear backoff
      this.backoff.set(trigger.id, { count: 0, until: 0 });

      if (results.length > 0) {
        this._log('trigger', `Email trigger "${trigger.name}": ${results.length} matching message(s)`);
        this.emit('triggered', trigger, { source: 'email', messages: results });
      }
    } catch (err) {
      // Exponential backoff: 10s, 20s, 40s, 80s … capped at 5 min
      const count     = (bo.count || 0) + 1;
      const delaySec  = Math.min(300, 10 * Math.pow(2, count - 1));
      this.backoff.set(trigger.id, { count, until: Date.now() + delaySec * 1000 });
      this._log('error', `Email poll failed (${trigger.name}): ${err.message} — retrying in ${delaySec}s`);
    }
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────
  add(trigger) {
    this.triggers.set(trigger.id, trigger);
    if (this.running && trigger.enabled && trigger.type === 'email') {
      this._startEmailPoller(trigger);
    }
  }

  remove(id) {
    this.triggers.delete(id);
    if (this.timers.has(id)) {
      clearInterval(this.timers.get(id));
      this.timers.delete(id);
    }
    this.lastFired.delete(id);
    this.backoff.delete(id);
  }

  update(id, data) {
    const t = this.triggers.get(id);
    if (!t) return;
    const updated = { ...t, ...data };
    this.triggers.set(id, updated);

    // Restart email poller if config changed
    if (updated.type === 'email' && this.running) {
      if (this.timers.has(id)) { clearInterval(this.timers.get(id)); this.timers.delete(id); }
      if (updated.enabled) this._startEmailPoller(updated);
    }
  }

  updateConfig(cfg) { this.config = cfg; }

  _log(level, message) { this.emit('log', { level, message, time: Date.now() }); }
}

module.exports = { TriggerManager };
