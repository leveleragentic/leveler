const EventEmitter = require('events');
const { AgentRunner } = require('./agentRunner');
const { TriggerManager } = require('./triggers');
const crypto = require('crypto');

const QUEUE_MAX = 20;

class Leverler extends EventEmitter {
  constructor(config = {}) {
    super();
    this.confirmTrigger = config.confirmTrigger || null;
    this.config = {
      ollamaHost:           'http://localhost:11434',
      ollamaModel:          'qwen2.5:7b',
      ollamaTemperature:    0.4,
      maxConcurrentAgents:  3,
      triggers:             [],
      ...config,
    };
    delete this.config.confirmTrigger;

    this.agents       = new Map();
    this.triggerQueue = [];          // pending { trigger, context } when at capacity
    this.isRunning    = false;
    this.stats        = { triggered: 0, completed: 0, failed: 0 };

    this.runner   = new AgentRunner({
      host:        this.config.ollamaHost,
      model:       this.config.ollamaModel,
      temperature: this.config.ollamaTemperature,
    });
    this.triggers = new TriggerManager(this.config);

    this.triggers.on('triggered', (trigger, ctx) => {
      this.emit('trigger:fired', { trigger, ctx, time: Date.now() });
      this._handleTrigger(trigger, ctx);
    });
    this.triggers.on('log', (entry) => this.emit('log', entry));
  }

  // ── Lifecycle ────────────────────────────────────────────────────────
  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    await this.triggers.start();
    this._log('info', `Leverler started — model: ${this.config.ollamaModel} @ ${this.config.ollamaHost}`);
    this.emit('leverler:status', { running: true });
  }

  async stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    await this.triggers.stop();
    this._log('info', 'Leverler paused');
    this.emit('leverler:status', { running: false });
  }

  // ── Trigger → agent ──────────────────────────────────────────────────
  async _handleTrigger(trigger, context) {
    this.stats.triggered++;
    const active = [...this.agents.values()].filter(a => a.status === 'running').length;

    if (active >= this.config.maxConcurrentAgents) {
      if (this.triggerQueue.length < QUEUE_MAX) {
        this.triggerQueue.push({ trigger, context });
        this._log('info', `Trigger queued: "${trigger.name}" (queue depth: ${this.triggerQueue.length})`);
        this.emit('queue:update', { depth: this.triggerQueue.length });
      } else {
        this._log('warn', `Queue full (${QUEUE_MAX}) — trigger dropped: ${trigger.name}`);
      }
      return;
    }

    if (this.confirmTrigger) {
      const ok = await this.confirmTrigger(trigger, context).catch(() => false);
      if (!ok) {
        this._log('info', `Trigger "${trigger.name}" dismissed by user`);
        return;
      }
    }

    await this.launchAgent({
      type:        trigger.agentType   || 'custom',
      prompt:      trigger.agentPrompt,
      name:        `${trigger.name} agent`,
      context,
      triggeredBy: trigger.name,
    });
  }

  // ── Process queue after an agent slot opens ───────────────────────────
  _processQueue() {
    if (!this.triggerQueue.length) return;
    const active = [...this.agents.values()].filter(a => a.status === 'running').length;
    if (active >= this.config.maxConcurrentAgents) return;

    const next = this.triggerQueue.shift();
    this.emit('queue:update', { depth: this.triggerQueue.length });
    this._log('info', `Processing queued trigger: "${next.trigger.name}" (${this.triggerQueue.length} remaining)`);
    this._handleTrigger(next.trigger, next.context);
  }

  // ── Launch ───────────────────────────────────────────────────────────
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
      // stored for retry
      _prompt:     prompt,
      _context:    context,
    };

    this.agents.set(id, agent);
    this.emit('agent:start', this._publicAgent(agent));
    this._log('agent', `Agent launched: ${agent.name} [${type}]`);

    try {
      const result = await this.runner.run({
        type, prompt, context,
        onProgress: (msg) => {
          agent.progress.push({ t: Date.now(), msg });
          this.emit('agent:update', { id, msg });
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

    this.emit('agent:complete', this._publicAgent(agent));
    this._processQueue();
    return id;
  }

  // ── Retry a failed agent ──────────────────────────────────────────────
  retryAgent(id) {
    const agent = this.agents.get(id);
    if (!agent || agent.status !== 'error') return false;
    this._log('info', `Retrying agent: ${agent.name}`);
    this.launchAgent({
      type:        agent.type,
      prompt:      agent._prompt,
      name:        agent.name,
      context:     agent._context,
      triggeredBy: agent.triggeredBy,
    });
    return true;
  }

  // ── Strip internal fields before sending to renderer ─────────────────
  _publicAgent(agent) {
    const { _prompt, _context, ...pub } = agent;
    return { ...pub };
  }

  // ── Ollama health check ───────────────────────────────────────────────
  async checkOllama() {
    return this.runner.ping();
  }

  // ── Trigger CRUD ─────────────────────────────────────────────────────
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

  // ── Config / state ────────────────────────────────────────────────────
  setConfig(cfg) {
    this.config = { ...this.config, ...cfg };
    this.runner.updateConfig({
      host:        this.config.ollamaHost,
      model:       this.config.ollamaModel,
      temperature: this.config.ollamaTemperature,
    });
    this.triggers.updateConfig(this.config);
  }

  getState() {
    const safeTriggers = this.config.triggers.map(t => {
      if (!t.emailConfig) return t;
      const { pass, encPass, ...emailCfg } = t.emailConfig;
      return { ...t, emailConfig: emailCfg };
    });
    return {
      isRunning:   this.isRunning,
      stats:       { ...this.stats },
      queueDepth:  this.triggerQueue.length,
      agents:      [...this.agents.values()].map(a => this._publicAgent(a)),
      triggers:    safeTriggers,
      config:      { ...this.config, triggers: undefined },
    };
  }

  _log(level, message) {
    this.emit('log', { level, message, time: Date.now() });
  }
}

module.exports = { Leverler };
