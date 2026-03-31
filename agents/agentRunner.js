const { Ollama } = require('ollama');
const { TOOL_DEFINITIONS, executeTool } = require('./tools');

// ── Default model config ────────────────────────────────────────────────────
const DEFAULTS = {
  model:       'qwen2.5:7b',
  host:        'http://localhost:11434',
  temperature: 0.4,
  maxTokens:   2048,
};

// ── Tool guidance appended to every system prompt ───────────────────────────
const TOOL_GUIDANCE = `

You have access to these tools — use them to take real actions rather than just describing what you would do:
- write_to_clipboard: Write a result directly to the user's clipboard so they can paste it
- save_to_file: Save output to a file on the Desktop (summaries, drafts, reports, code)
- fetch_url: Retrieve the content of a web page or API endpoint
- open_url: Open a URL in the default browser
- send_notification: Send the user a system notification with a key finding

Always prefer using tools to produce concrete output. Think step by step, then act.`;

// ── System prompts per agent type ───────────────────────────────────────────
const SYSTEM_PROMPTS = {
  email: `You are an email management agent. Given email context:
- Summarize key points and action items clearly
- Draft a reply if appropriate and save it with save_to_file (e.g. "reply-draft.txt")
- Send a notification with the urgency level and one-line summary
- Flag urgency: URGENT / ACTION-REQUIRED / FYI / SPAM
${TOOL_GUIDANCE}`,

  web: `You are a web research agent. Given a topic or question:
- Use fetch_url to retrieve relevant pages or sources
- Synthesize what you find into a structured research report
- Save the report to a file using save_to_file (e.g. "research-report.md")
- Send a notification when done with a one-line summary
- Be factual. Acknowledge uncertainty.
${TOOL_GUIDANCE}`,

  custom: `You are an autonomous AI agent running locally on the user's machine.
Complete the given task efficiently and thoroughly. Think step by step.
Use tools to produce concrete, actionable output — don't just explain what you'd do.
${TOOL_GUIDANCE}`,
};

const MAX_STEPS = 10;

class AgentRunner {
  constructor(config = {}) {
    this.config = { ...DEFAULTS, ...config };
    this.ollama = new Ollama({ host: this.config.host });
  }

  updateConfig(cfg) {
    this.config = { ...this.config, ...cfg };
    this.ollama  = new Ollama({ host: this.config.host });
  }

  // ── Model name validation ──────────────────────────────────────────────
  _validateModelName(name) {
    return typeof name === 'string' && /^[a-zA-Z0-9._:/@-]{1,100}$/.test(name);
  }

  // ── Context sanitization ───────────────────────────────────────────────
  _sanitize(text, maxLen = 2000) {
    if (!text) return text;
    return String(text)
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
      .slice(0, maxLen);
  }

  // ── Health check ───────────────────────────────────────────────────────
  async ping() {
    try {
      const list = await this.ollama.list();
      return { ok: true, models: (list.models || []).map(m => m.name) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // ── Main agent runner — agentic tool-use loop ──────────────────────────
  async run({ type, prompt, context, onProgress }) {
    if (!this._validateModelName(this.config.model)) {
      throw new Error(`Invalid model name: "${this.config.model}"`);
    }

    onProgress?.(`Connecting to Ollama at ${this.config.host}…`);

    const health = await this.ping();
    if (!health.ok) {
      throw new Error(
        `Cannot reach Ollama at ${this.config.host}. ` +
        `Is it running? Try: ollama serve`
      );
    }

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
      { role: 'system', content: system },
      { role: 'user',   content: userMsg },
    ];

    let finalText  = '';
    let toolsWork  = true; // set to false if model doesn't support tools

    for (let step = 0; step < MAX_STEPS; step++) {
      onProgress?.(step === 0 ? 'Thinking…' : `Thinking… (step ${step + 1})`);

      let response;
      try {
        response = await this.ollama.chat({
          model:    this.config.model,
          messages,
          tools:    toolsWork ? TOOL_DEFINITIONS : undefined,
          stream:   false,
          options: {
            temperature: this.config.temperature,
            num_predict:  this.config.maxTokens,
          },
        });
      } catch (err) {
        // If first step fails with tools, retry without (model doesn't support tool calling)
        if (step === 0 && toolsWork) {
          toolsWork = false;
          onProgress?.('Model does not support tool calling — running in text-only mode');
          response = await this.ollama.chat({
            model:   this.config.model,
            messages,
            stream:  false,
            options: { temperature: this.config.temperature, num_predict: this.config.maxTokens },
          });
        } else {
          throw err;
        }
      }

      const msg = response.message;
      messages.push(msg);
      if (msg.content) finalText = msg.content;

      // No tool calls — we're done
      if (!msg.tool_calls?.length) break;

      // Execute each tool call
      for (const tc of msg.tool_calls) {
        const { name, arguments: args } = tc.function;
        onProgress?.(`Tool: ${name}(${JSON.stringify(args).slice(0, 120)})`);

        let result;
        try {
          result = await executeTool(name, typeof args === 'string' ? JSON.parse(args) : args);
          onProgress?.(`  → ${String(result).slice(0, 150)}`);
        } catch (toolErr) {
          result = `Error: ${toolErr.message}`;
          onProgress?.(`  → Error: ${toolErr.message}`);
        }

        messages.push({ role: 'tool', content: String(result) });
      }
    }

    onProgress?.('Done');
    return finalText.trim() || '(No output)';
  }

  // ── Build user message ────────────────────────────────────────────────
  _buildUserMessage(type, prompt, context) {
    const parts = [];
    if (prompt) parts.push(this._sanitize(prompt, 4000));

    if (context) {
      if (typeof context === 'string') {
        parts.push(`\nContext:\n${this._sanitize(context)}`);
      } else if (context.text) {
        parts.push(`\nClipboard content:\n${this._sanitize(context.text)}`);
        if (context.matchedKeyword) {
          parts.push(`(Triggered by keyword: "${this._sanitize(context.matchedKeyword, 100)}")`);
        }
      } else if (context.messages) {
        const msgs = context.messages.slice(0, 5)
          .map(m => `• From: ${this._sanitize(m.from, 200)}\n  Subject: ${this._sanitize(m.subject, 300)}`).join('\n');
        parts.push(`\nEmails to process:\n${msgs}`);
      }
    }

    if (!parts.length) parts.push('Complete your assigned task.');
    return parts.join('\n');
  }
}

module.exports = { AgentRunner };
