# LEVERLER v2
### Loitering AI Agent Orchestrator — Local LLM Edition

Runs silently in your system tray, watches for triggers, and autonomously launches
AI agents in response — 100% on-device via Ollama. No API keys. No cloud. No data leaves your machine.

---

## ✦ What changed in v2

| | v1 | v2 |
|---|---|---|
| Model | Anthropic Claude (cloud) | Qwen2.5 via Ollama (local) |
| API key required | Yes | No |
| Data leaves machine | Yes | Never |
| Cost per agent run | ~$0.01–0.10 | $0 |
| Offline support | No | Yes |
| Web search | Built-in | Not included (local only) |

---

## ⚡ Quick Start

### 1. Install Ollama
```bash
# macOS
brew install ollama

# or download from
https://ollama.com
```

### 2. Pull Qwen2.5
```bash
ollama pull qwen2.5:7b      # fast, recommended
ollama pull qwen2.5:14b     # smarter, needs ~10GB RAM
```

### 3. Start Ollama
```bash
ollama serve
# Runs at http://localhost:11434
```

### 4. Install & run Leverler
```bash
cd leverler
npm install
npm start
```

### 5. Test the connection
Open **Settings** in the app and click **Test Connection** — you'll see your available models listed.

---

## 🤖 Model Recommendations

| Model | VRAM / RAM | Speed | Best for |
|-------|-----------|-------|----------|
| `qwen2.5:7b` | ~5GB | Fast | Daily use, email, summaries |
| `qwen2.5:14b` | ~9GB | Medium | Complex reasoning, research |
| `qwen2.5:3b` | ~2GB | Very fast | Low-resource machines |
| `llama3.2:3b` | ~2GB | Fast | Alternative lightweight option |

On Apple Silicon (M1/M2/M3), the 7B runs in ~1–3 seconds per response. The 14B in ~5–10s.

---

## 🎯 Setting Up Triggers

### Keyword Trigger (Clipboard)
Leverler watches your clipboard every 1.5 seconds. When copied text contains one of
your keywords, it fires the linked agent automatically.

### Email Trigger (IMAP)
For Gmail, use an [App Password](https://myaccount.google.com/apppasswords):
- Host: `imap.gmail.com`
- User: `your@gmail.com`
- Pass: your 16-character App Password

---

## 📁 Structure

```
leverler/
├── main.js                 ← Electron main process
├── preload.js              ← Secure IPC bridge
├── agents/
│   ├── leverler.js         ← Orchestration engine
│   ├── triggers.js         ← Clipboard + email listeners
│   └── agentRunner.js      ← Ollama agent execution (streaming)
├── renderer/
│   ├── index.html
│   ├── style.css
│   └── app.js
└── .env                    ← Optional: OLLAMA_HOST, OLLAMA_MODEL
```

---

## ⚙️ Optional .env overrides

```env
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen2.5:14b
OLLAMA_TEMP=0.3
```

Settings saved in-app take precedence at runtime.

---

## 🔒 Privacy
Everything stays on your machine. No telemetry, no analytics, no external calls.
