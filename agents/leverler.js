const EventEmitter = require('events');
const { AgentRunner } = require('./agentRunner');
const { TriggerManager } = require('./triggers');
const crypto = require('crypto');

class Leverler extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      apiKey: '',
      maxConcurrentAgents: 3,
      triggers: [],
      agentDefs: [],
      ...config,
    };

    this.agents = new Map();     // id → agent state
    this.isRunning = false;
    this.stats = { triggered: 0, completed: 0, failed: 0 };

    this.runner   = new AgentRunner(this.config.apiKey);
    this.triggers = new TriggerManager(this.config);

    this.triggers.on('triggered', (trigger, ctx) => {
      this.emit('trigger:fired', { trigger, ctx, time: Date.now() });
      this._handleTrigger(trigger, ctx);
    });
    this.triggers.on('log', (entry) => this.emit('log', entry));
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    await this.triggers.start();
    this._log('info', 'Leverler started — loitering for triggers');
    this.emit('leverler:status', { running: true });
  }

  async stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    await this.triggers.stop();
    this._log('info', 'Leverler paused');
    this.emit('leverler:status', { running: false });
  }

  // ── Trigger handling ───────────────────────────────────────────────────────
  async _handleTrigger(trigger, context) {
    this.stats.triggered++;
    const running = [...this.agents.values()].filter(a => a.status === 'running').length;
    if (running >= this.config.maxConcurrentAgents) {
      this._log('warn', `Agent cap (${this.config.maxConcurrentAgents}) reached — skipping trigger: ${trigger.name}`);
      return;
    }
    await this.launchAgent({
      type:        trigger.agentType  || 'custom',
      prompt:      trigger.agentPrompt,
      name:        `${trigger.name} agent`,
      context,
      triggeredBy: trigger.name,
    });
  }

  // ── Agent launch ───────────────────────────────────────────────────────────
  async launchAgent({ type, prompt, name, context, triggeredBy = 'manual' }) {
    const id = crypto.randomUUID();
    const agent = {
      id,
      name:        name || `${type} agent`,
      type,
      status:      'running',
      triggeredBy,
      startTime:   Date.now(),
      endTime:     null,
      progress:    [],
      result:      null,
      error:       null,
    };

    this.agents.set(id, agent);
    this.emit('agent:start', { ...agent });
    this._log('agent', `Agent launched: ${agent.name}`);

    try {
      const result = await this.runner.run({
        type,
        prompt,
        context,
        onProgress: (msg) => {
          agent.progress.push({ t: Date.now(), msg });
          this.emit('agent:update', { id, msg });
          this._log('agent', `[${agent.name}] ${msg}`);
        },
      });

      agent.status  = 'complete';
      agent.result  = result;
      agent.endTime = Date.now();
      this.stats.completed++;
      this._log('success', `Agent complete: ${agent.name}`);
    } catch (err) {
      agent.status  = 'error';
      agent.error   = err.message;
      agent.endTime = Date.now();
      this.stats.failed++;
      this._log('error', `Agent failed: ${agent.name} — ${err.message}`);
    }

    this.emit('agent:complete', { ...agent });
    return id;
  }

  // ── Trigger CRUD ──────────────────────────────────────────────────────────
  addTrigger(trigger) {
    const full = { ...trigger, id: crypto.randomUUID(), enabled: true };
    this.config.triggers.push(full);
    this.triggers.add(full);
    return full;
  }

  removeTrigger(id) {
    this.config.triggers = this.config.triggers.filter(t => t.id !== id);
    this.triggers.remove(id);
  }

  updateTrigger(id, data) {
    const idx = this.config.triggers.findIndex(t => t.id === id);
    if (idx !== -1) {
      this.config.triggers[idx] = { ...this.config.triggers[idx], ...data };
      this.triggers.update(id, data);
    }
  }

  // ── Config / state ────────────────────────────────────────────────────────
  setConfig(cfg) {
    this.config = { ...this.config, ...cfg };
    if (cfg.apiKey) this.runner.setApiKey(cfg.apiKey);
    this.triggers.updateConfig(this.config);
  }

  getState() {
    return {
      isRunning: this.isRunning,
      stats:     { ...this.stats },
      agents:    [...this.agents.values()].map(a => ({ ...a })),
      triggers:  this.config.triggers,
      config: {
        ...this.config,
        apiKey: this.config.apiKey ? '●●●●●●●●' : '',
      },
    };
  }

  _log(level, message) {
    this.emit('log', { level, message, time: Date.now() });
  }
}

module.exports = { Leverler };
