# Leverler v2

**Local AI Agent Orchestrator**

Leverler runs silently in your system tray, monitors clipboard content and email inboxes for configurable triggers, and autonomously launches AI agents in response. All inference runs on-device via [Ollama](https://ollama.com) — no API keys, no cloud services, no data leaves your machine.

---

## What's new in v2

| | v1 | v2 |
|---|---|---|
| Model backend | Anthropic Claude (cloud) | Ollama (local) |
| API key required | Yes | No |
| Data leaves machine | Yes | No |
| Cost per agent run | ~$0.01–$0.10 | Free |
| Offline support | No | Yes |

---

## Requirements

- [Node.js](https://nodejs.org) 18 or later
- [Ollama](https://ollama.com) running locally
- macOS, Windows, or Linux

---

## Quick Start

### 1. Install Ollama

```bash
# macOS
brew install ollama

# or download from https://ollama.com
```

### 2. Pull a model

```bash
ollama pull qwen2.5:7b      # recommended — fast, ~5GB RAM
ollama pull qwen2.5:14b     # higher quality, ~10GB RAM
```

### 3. Start the Ollama server

```bash
ollama serve
# Listens at http://localhost:11434 by default
```

### 4. Install and run Leverler

```bash
cd leverler
npm install
npm start
```

### 5. Verify the connection

Open **Settings** in the app and click **Test Connection**. If Ollama is running, available models will be listed automatically.

---

## Model Reference

| Model | RAM Required | Speed | Recommended for |
|-------|-------------|-------|-----------------|
| `qwen2.5:3b` | ~2 GB | Very fast | Low-resource machines |
| `qwen2.5:7b` | ~5 GB | Fast | General use — default |
| `qwen2.5:14b` | ~9 GB | Moderate | Complex reasoning, research |
| `llama3.2:3b` | ~2 GB | Fast | Lightweight alternative |

On Apple Silicon (M1/M2/M3), the 7B model typically produces a response in 1–3 seconds. The 14B takes 5–10 seconds.

---

## What Agents Can Do

Agents are not limited to generating text. Each agent has access to a set of built-in tools it can call during execution:

| Tool | Description |
|------|-------------|
| `write_to_clipboard` | Write output directly to the clipboard for immediate paste |
| `save_to_file` | Save content as a named file on the Desktop |
| `fetch_url` | Retrieve the text content of a web page or HTTP API endpoint |
| `open_url` | Open a URL in the default browser |
| `send_notification` | Send a system notification with a summary or alert |

Tool calling requires a model that supports function calling (Qwen2.5 and Llama 3.1+ work well). If the model does not support tools, Leverler falls back to text-only mode automatically.

Agents run in a loop of up to 10 steps, calling tools as needed before producing a final response.

---

## Triggers

### Keyword Trigger (Clipboard)

Leverler polls the clipboard every 1.5 seconds. When copied text contains a configured keyword, the linked agent fires automatically. Each trigger has a 30-second cooldown by default to prevent repeated firing.

When a trigger is detected, a confirmation dialog appears before the agent launches. This prevents unintended execution from unexpected clipboard content.

Keywords support plain substring matching or regex syntax. To use a regex, wrap it in forward slashes:

```
invoice          plain substring match (case-insensitive)
/invoice \d+/i   regex match
/^urgent:/i      anchored regex
```

### Email Trigger (IMAP)

Leverler polls an IMAP inbox at a configurable interval (default: 120 seconds). Matching unread messages by keyword trigger the linked agent.

**Gmail setup:** Use an [App Password](https://myaccount.google.com/apppasswords) rather than your account password.
- Host: `imap.gmail.com`
- User: `your@gmail.com`
- Password: 16-character App Password

IMAP credentials are encrypted at rest using the operating system keychain (`safeStorage`). They are never sent to the renderer process or stored in plain text.

If IMAP polling fails, Leverler backs off exponentially: 10s, 20s, 40s, up to a maximum of 5 minutes between retries. The backoff resets on a successful poll.

### Trigger Queue

When all agent slots are full, incoming triggers are queued (up to 20) rather than dropped. Queued triggers are processed automatically as running agents complete. The current queue depth is shown on the dashboard.

---

## Configuration

Settings are saved automatically to your OS user data directory and restored on next launch. The `.env` file can be used for environment-level overrides:

```env
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen2.5:14b
OLLAMA_TEMP=0.3
```

In-app settings take precedence over `.env` values at runtime.

---

## Project Structure

```
leverler/
├── main.js                 Electron main process, IPC handlers, config persistence
├── preload.js              Secure context bridge (contextIsolation enabled)
├── agents/
│   ├── leverler.js         Orchestration engine, agent lifecycle, trigger queue, retry
│   ├── triggers.js         Clipboard monitor and IMAP email poller
│   ├── agentRunner.js      Ollama integration with agentic tool-use loop
│   └── tools.js            Built-in tool implementations
├── renderer/
│   ├── index.html          UI layout
│   ├── style.css           Dark theme
│   └── app.js              UI logic and event handling
└── .env                    Optional environment overrides
```

---

## Agent Retry

Failed agents show a Retry button in the Agents view. Retrying re-runs the agent with the same prompt and context without requiring any reconfiguration.

---

## Security

- All LLM inference runs locally. No external network requests are made during agent execution except via the `fetch_url` tool, which is invoked explicitly by the agent.
- IMAP passwords are encrypted using Electron's `safeStorage` API (OS keychain) and are never exposed to the renderer process.
- Clipboard and email content is sanitized and truncated before being passed to the model.
- Model names are validated against a safe character pattern before use.
- `contextIsolation` is enabled and `nodeIntegration` is disabled in the renderer.
- A confirmation dialog is shown before any externally-triggered agent launches.
