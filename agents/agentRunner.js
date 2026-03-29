const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM_PROMPTS = {
  email: `You are an email management agent. Analyze the provided email context and take action:
- Summarize key points and action items
- Draft a suggested reply if appropriate
- Flag urgency or important details
- Categorize: (urgent / FYI / action-required / spam)
Be concise and professional.`,

  web: `You are a web research agent. Your job is to search the web, synthesize findings, and return a clear, well-structured report. Always include sources. Be factual and comprehensive.`,

  custom: `You are an autonomous AI agent. Complete the given task efficiently and thoroughly. Think step-by-step and provide clear output.`,
};

class AgentRunner {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  setApiKey(apiKey) {
    this.apiKey = apiKey;
    this.client = new Anthropic({ apiKey });
  }

  async run({ type, prompt, context, onProgress }) {
    if (!this.client) {
      throw new Error('No Anthropic API key configured — add your key in Settings.');
    }

    const system      = SYSTEM_PROMPTS[type] || SYSTEM_PROMPTS.custom;
    const userContent = this._buildUserMessage(type, prompt, context);
    const tools       = this._getTools(type);

    onProgress?.(`Initializing ${type} agent…`);

    let messages = [{ role: 'user', content: userContent }];
    let resp;
    let iters = 0;
    const MAX = 6;

    while (iters < MAX) {
      iters++;
      const params = {
        model:      'claude-opus-4-5',
        max_tokens: 2048,
        system,
        messages,
        ...(tools.length ? { tools } : {}),
      };

      resp = await this.client.messages.create(params);
      onProgress?.(`Claude responded (stop: ${resp.stop_reason})`);

      if (resp.stop_reason !== 'tool_use') break;

      // Handle tool calls
      const toolCalls = resp.content.filter(b => b.type === 'tool_use');
      const toolResults = [];

      for (const tc of toolCalls) {
        onProgress?.(`Using tool: ${tc.name}`);
        toolResults.push({
          type:        'tool_result',
          tool_use_id: tc.id,
          content:     `Tool ${tc.name} executed. Results handled by Anthropic.`,
        });
      }

      messages = [
        ...messages,
        { role: 'assistant', content: resp.content },
        { role: 'user',      content: toolResults },
      ];
    }

    const text = (resp?.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    onProgress?.('Agent finished');
    return text || '(No output)';
  }

  _buildUserMessage(type, prompt, context) {
    const parts = [];
    if (prompt) parts.push(prompt);

    if (context) {
      if (typeof context === 'string') {
        parts.push(`\nContext:\n${context}`);
      } else if (context.text) {
        parts.push(`\nClipboard content:\n${context.text}`);
        if (context.matchedKeyword) parts.push(`(Triggered by keyword: "${context.matchedKeyword}")`);
      } else if (context.messages) {
        const msgs = context.messages.slice(0, 5)
          .map(m => `• [${m.from}] ${m.subject}`).join('\n');
        parts.push(`\nEmail messages to process:\n${msgs}`);
      }
    }

    if (!parts.length) parts.push('Complete your task.');
    return parts.join('\n');
  }

  _getTools(type) {
    if (type === 'web') {
      return [{ type: 'web_search_20250305', name: 'web_search' }];
    }
    return [];
  }
}

module.exports = { AgentRunner };
