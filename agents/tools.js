const { clipboard, shell, Notification, app } = require('electron');
const fs   = require('fs');
const path = require('path');
const http  = require('http');
const https = require('https');

// ── Tool definitions (Ollama function-calling format) ──────────────────────
const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'write_to_clipboard',
      description: 'Write text to the system clipboard. Use this to return a result directly to the user so they can paste it immediately.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to write to the clipboard' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_to_file',
      description: 'Save text content to a file on the Desktop. Use this for longer outputs like summaries, drafts, reports, or code.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Filename with extension, e.g. "summary.md", "reply.txt", "report.md"' },
          content:  { type: 'string', description: 'The text content to write to the file' },
        },
        required: ['filename', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetch the text content of a web page or HTTP API endpoint. Use this to research a topic, read an article, or call a local API.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The full URL to fetch (http or https only)' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_url',
      description: 'Open a URL in the default browser. Use this when the user should see a page directly.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to open' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_notification',
      description: 'Send a system notification. Use this to surface a key finding or completed action to the user.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short notification title' },
          body:  { type: 'string', description: 'Notification body (1-2 sentences)' },
        },
        required: ['title', 'body'],
      },
    },
  },
];

// ── Tool execution ─────────────────────────────────────────────────────────
async function executeTool(name, args) {
  switch (name) {
    case 'write_to_clipboard': {
      clipboard.writeText(String(args.text ?? ''));
      return 'Written to clipboard.';
    }

    case 'save_to_file': {
      const desktopPath = app.getPath('desktop');
      // Strip directory traversal and unsafe characters from filename
      const safe = path.basename(String(args.filename || 'output.txt'))
        .replace(/[^a-zA-Z0-9._\- ]/g, '_')
        .slice(0, 100);
      const fullPath = path.join(desktopPath, safe);
      fs.writeFileSync(fullPath, String(args.content ?? ''), 'utf8');
      return `Saved to ${fullPath}`;
    }

    case 'fetch_url': {
      return await fetchUrl(String(args.url ?? ''));
    }

    case 'open_url': {
      const url = String(args.url ?? '');
      const parsed = new URL(url); // throws on invalid URL
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Only http/https URLs can be opened');
      }
      await shell.openExternal(url);
      return `Opened ${url} in browser.`;
    }

    case 'send_notification': {
      new Notification({
        title: String(args.title ?? 'Leverler'),
        body:  String(args.body  ?? ''),
      }).show();
      return 'Notification sent.';
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── URL fetcher ────────────────────────────────────────────────────────────
function fetchUrl(rawUrl) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(rawUrl); } catch { return reject(new Error(`Invalid URL: ${rawUrl}`)); }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return reject(new Error('Only http/https URLs are supported'));
    }

    const lib = parsed.protocol === 'https:' ? https : http;
    let aborted = false;

    const req = lib.get(rawUrl, {
      timeout: 12000,
      headers: { 'User-Agent': 'Leverler/2.0', 'Accept': 'text/html,text/plain,*/*' },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        raw += chunk;
        if (raw.length > 200_000 && !aborted) { aborted = true; req.destroy(); }
      });
      res.on('end', () => {
        // Strip scripts, styles, then all HTML tags; collapse whitespace
        const text = raw
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 12_000);
        resolve(text || '(empty response)');
      });
    });

    req.on('error', (err) => { if (!aborted) reject(err); else resolve('(response truncated at size limit)'); });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out after 12s')); });
  });
}

module.exports = { TOOL_DEFINITIONS, executeTool };
