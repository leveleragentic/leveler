const EventEmitter = require('events');
const { clipboard } = require('electron');

class TriggerManager extends EventEmitter {
  constructor(config) {
    super();
    this.config   = config;
    this.triggers = new Map();   // id → trigger
    this.timers   = new Map();   // id → timer handle
    this.running  = false;
    this.lastClip = '';
    this.clipTimer = null;

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

  _checkKeywords(text, source) {
    const lower = text.toLowerCase();
    this.triggers.forEach(trigger => {
      if (!trigger.enabled || trigger.type !== 'keyword') return;
      const match = (trigger.keywords || []).find(kw =>
        kw && lower.includes(kw.toLowerCase())
      );
      if (match) {
        this._log('trigger', `Keyword hit: "${match}" via ${source}`);
        this.emit('triggered', trigger, { source, text: text.slice(0, 800), matchedKeyword: match });
      }
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

      if (results.length > 0) {
        this._log('trigger', `Email trigger "${trigger.name}": ${results.length} matching message(s)`);
        this.emit('triggered', trigger, { source: 'email', messages: results });
      }
    } catch (err) {
      this._log('error', `Email poll failed (${trigger.name}): ${err.message}`);
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
