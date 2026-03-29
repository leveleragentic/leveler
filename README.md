# LEVERLER
### Loitering AI Agent Orchestrator

A desktop app that runs silently in your system tray, watches for triggers, and autonomously launches Claude AI agents in response.

---

## ✦ Features

- **Background listener** — lives in your system tray, always watching
- **Keyword triggers** — fires when clipboard text matches keywords you define
- **Email triggers** — polls an IMAP inbox and fires on matching emails
- **Agent types**: Email agent · Web research agent · Custom prompt agent
- **Live dashboard** — radar display, active agent cards, real-time log stream
- **Multi-agent** — run several agents concurrently

---

## ⚡ Quick Start

### 1. Prerequisites
- Node.js 18+ — [nodejs.org](https://nodejs.org)
- An Anthropic API key — [console.anthropic.com](https://console.anthropic.com)

### 2. Install
```bash
cd leverler
npm install
```

### 3. Configure API key
Either add it in-app (Settings tab), or create a `.env` file:
```
ANTHROPIC_API_KEY=sk-ant-…
```

### 4. Run
```bash
npm start
```

The app will appear in your **system tray** and open the dashboard.

---

## 🎯 Setting Up Triggers

### Keyword Trigger (Clipboard)
Leverler watches your clipboard every 1.5 seconds. When copied text contains one of your keywords, it fires the linked agent.

**Example**: Set keyword `"invoice"` + email agent → auto-drafts responses to invoice emails you copy.

### Email Trigger (IMAP)
For Gmail, use an [App Password](https://myaccount.google.com/apppasswords):
- Host: `imap.gmail.com`
- User: `your@gmail.com`  
- Pass: your 16-character App Password

Leverler polls on the interval you set and fires the agent for matching messages.

---

## 🤖 Agent Types

| Type | What it does |
|------|-------------|
| `custom` | Runs your prompt with the trigger context as input |
| `email` | Summarizes emails, drafts replies, categorizes urgency |
| `web` | Uses Claude's web search to research a topic and returns a report |

---

## 📁 Structure

```
leverler/
├── main.js              ← Electron main process (tray, window, IPC)
├── preload.js           ← Secure IPC bridge
├── agents/
│   ├── leverler.js     ← Orchestration engine
│   ├── triggers.js      ← Clipboard + email listeners
│   └── agentRunner.js   ← Anthropic API agent execution
├── renderer/
│   ├── index.html       ← UI shell
│   ├── style.css        ← Dark mission-control styles
│   └── app.js           ← UI logic
└── .env                 ← (create this) ANTHROPIC_API_KEY=...
```

---

## 🔒 Privacy
- Your API key is stored locally in `.env` and never sent anywhere except Anthropic's API.
- Email credentials are held in memory only; not written to disk.
- No telemetry, no analytics.

---

*Built with Electron + Anthropic SDK*
