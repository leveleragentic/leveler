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

## Triggers

### Keyword Trigger (Clipboard)

Leverler polls the clipboard every 1.5 seconds. When copied text contains a configured keyword, the linked agent fires automatically. Each trigger has a 30-second cooldown by default to prevent repeated firing.

When a trigger is detected, a confirmation dialog appears before the agent launches. This prevents unintended execution from unexpected clipboard content.

### Email Trigger (IMAP)

Leverler polls an IMAP inbox at a configurable interval (default: 120 seconds). Matching unread messages by keyword trigger the linked agent.

**Gmail setup:** Use an [App Password](https://myaccount.google.com/apppasswords) rather than your account password.
- Host: `imap.gmail.com`
- User: `your@gmail.com`
- Password: 16-character App Password

IMAP credentials are encrypted at rest using the operating system keychain (`safeStorage`). They are never sent to the renderer process or stored in plain text.

If IMAP polling fails, Leverler backs off exponentially: 10s, 20s, 40s, up to a maximum of 5 minutes between retries. The backoff resets on a successful poll.

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
│   ├── leverler.js         Orchestration engine, agent lifecycle, trigger routing
│   ├── triggers.js         Clipboard monitor and IMAP email poller
│   └── agentRunner.js      Ollama integration with streaming output
├── renderer/
│   ├── index.html          UI layout
│   ├── style.css           Dark theme
│   └── app.js              UI logic and event handling
└── .env                    Optional environment overrides
```

---

## Security

- All LLM inference runs locally. No external network requests are made during agent execution.
- IMAP passwords are encrypted using Electron's `safeStorage` API (OS keychain) and are never exposed to the renderer process.
- Clipboard and email content is sanitized and truncated before being passed to the model.
- Model names are validated against an allowlist pattern before use.
- `contextIsolation` is enabled and `nodeIntegration` is disabled in the renderer.
- A confirmation dialog is shown before any externally-triggered agent launches.
