const { Ollama } = require('ollama');

// ── Default model config ────────────────────────────────────────────────────
const DEFAULTS = {
  model:       'qwen2.5:7b',
  host:        'http://localhost:11434',
  temperature: 0.4,
  maxTokens:   2048,
};

// ── System prompts per agent type ───────────────────────────────────────────
const SYSTEM_PROMPTS = {
  email: `You are an email management agent. Analyze the provided email context and:
- Summarize key points and action items clearly
- Draft a suggested reply if appropriate
- Flag urgency level: URGENT / ACTION-REQUIRED / FYI / SPAM
- Keep your response structured and concise.`,

  web: `You are a web research agent. The user will give you a topic or question.
Reason through what you know thoroughly, cite any relevant facts, and return a
well-structured research report. Be factual. Acknowledge when you are uncertain.`,

  custom: `You are an autonomous AI agent running locally on the user's machine.
Complete the given task efficiently and thoroughly. Think step by step.
Provide clear, actionable output.`,
};

class AgentRunner {
  constructor(config = {}) {
    this.config = { ...DEFAULTS, ...config };
    this.ollama = new Ollama({ host: this.config.host });
  }

  updateConfig(cfg) {
    this.config = { ...this.config, ...cfg };
    this.ollama  = new Ollama({ host: this.config.host });
  }

  // ── Health check — called from settings UI ─────────────────────────────
  async ping() {
    try {
      const list = await this.ollama.list();
      return {
        ok:     true,
        models: (list.models || []).map(m => m.name),
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // ── Main agent runner ──────────────────────────────────────────────────
  async run({ type, prompt, context, onProgress }) {
    onProgress?.(`Connecting to Ollama at ${this.config.host}…`);

    // Verify Ollama is reachable
    const health = await this.ping();
    if (!health.ok) {
      throw new Error(
        `Cannot reach Ollama at ${this.config.host}. ` +
        `Is it running? Try: ollama serve`
      );
    }

    // Check the model exists
    const modelAvailable = health.models.some(m =>
      m === this.config.model || m.startsWith(this.config.model.split(':')[0])
    );
    if (!modelAvailable) {
      throw new Error(
        `Model "${this.config.model}" not found locally. ` +
        `Pull it first: ollama pull ${this.config.model}\n` +
        `Available: ${health.models.join(', ') || 'none'}`
      );
    }

    onProgress?.(`Using model: ${this.config.model}`);

    const system  = SYSTEM_PROMPTS[type] || SYSTEM_PROMPTS.custom;
    const userMsg = this._buildUserMessage(type, prompt, context);

    const messages = [
      { role: 'system',    content: system },
      { role: 'user',      content: userMsg },
    ];

    onProgress?.('Streaming response…');

    // ── Streaming response ───────────────────────────────────────────────
    let fullText = '';
    let chunkCount = 0;

    const stream = await this.ollama.chat({
      model:    this.config.model,
      messages,
      stream:   true,
      options: {
        temperature:  this.config.temperature,
        num_predict:  this.config.maxTokens,
      },
    });

    for await (const chunk of stream) {
      const token = chunk.message?.content || '';
      fullText   += token;
      chunkCount++;

      // Emit progress every ~80 chars so the UI feels alive
      if (chunkCount % 20 === 0) {
        const preview = fullText.slice(-60).replace(/\n/g, ' ');
        onProgress?.(`…${preview}`);
      }
    }

    onProgress?.('Done');
    return fullText.trim() || '(No output)';
  }

  // ── Build user message ────────────────────────────────────────────────
  _buildUserMessage(type, prompt, context) {
    const parts = [];
    if (prompt) parts.push(prompt);

    if (context) {
      if (typeof context === 'string') {
        parts.push(`\nContext:\n${context}`);
      } else if (context.text) {
        parts.push(`\nClipboard content:\n${context.text}`);
        if (context.matchedKeyword) {
          parts.push(`(Triggered by keyword: "${context.matchedKeyword}")`);
        }
      } else if (context.messages) {
        const msgs = context.messages.slice(0, 5)
          .map(m => `• From: ${m.from}\n  Subject: ${m.subject}`).join('\n');
        parts.push(`\nEmails to process:\n${msgs}`);
      }
    }

    if (!parts.length) parts.push('Complete your assigned task.');
    return parts.join('\n');
  }
}

module.exports = { AgentRunner };
