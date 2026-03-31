/* ═══════════════════════════════════════════════════════
   LEVERLER v2 — Renderer / UI Logic (Ollama edition)
   ═══════════════════════════════════════════════════════ */

// ── State ───────────────────────────────────────────────
const state = {
  isRunning:  false,
  agents:     [],
  triggers:   [],
  logs:       [],
  logsPaused: false,
  queueDepth: 0,
  stats:      { triggered: 0, completed: 0, failed: 0, active: 0 },
  startedAt:  null,
  config:     {
    ollamaHost:        'http://localhost:11434',
    ollamaModel:       'qwen2.5:7b',
    ollamaTemperature: 0.4,
    maxConcurrentAgents: 3,
  },
};

// ── DOM helpers ─────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

// ── Navigation ──────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    $(`view-${btn.dataset.view}`).classList.add('active');
  });
});

// ── Tabs ─────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $('agents-running').classList.add('hidden');
    $('agents-history').classList.add('hidden');
    $(`agents-${btn.dataset.tab}`).classList.remove('hidden');
  });
});

// ── Start / Stop ─────────────────────────────────────────
$('startStopBtn').addEventListener('click', async () => {
  state.isRunning ? await window.leverler.stop() : await window.leverler.start();
});

// ── Leverler events ──────────────────────────────────────
window.leverler.on('leverler:status', ({ running }) => {
  state.isRunning = running;
  if (running) state.startedAt = Date.now();
  updateRunningState(running);
});

window.leverler.on('agent:start', (agent) => {
  const idx = state.agents.findIndex(a => a.id === agent.id);
  if (idx === -1) state.agents.unshift(agent);
  else state.agents[idx] = agent;
  state.stats.active = state.agents.filter(a => a.status === 'running').length;
  renderAll();
});

window.leverler.on('agent:update', ({ id, msg }) => {
  const a = state.agents.find(a => a.id === id);
  if (a) { if (!a.progress) a.progress = []; a.progress.push({ t: Date.now(), msg }); }
  updateAgentDetailIfOpen(id);
});

window.leverler.on('agent:complete', (agent) => {
  const idx = state.agents.findIndex(a => a.id === agent.id);
  if (idx !== -1) state.agents[idx] = agent;
  else state.agents.unshift(agent);
  state.stats.active = state.agents.filter(a => a.status === 'running').length;
  if (agent.status === 'complete') state.stats.completed++;
  if (agent.status === 'error')    state.stats.failed++;
  renderAll();
  updateAgentDetailIfOpen(agent.id);
});

window.leverler.on('trigger:fired', ({ trigger }) => {
  state.stats.triggered++;
  addEvent(`Trigger: ${trigger.name}`);
  renderStats();
});

window.leverler.on('queue:update', ({ depth }) => {
  state.queueDepth = depth;
  renderStats();
});

window.leverler.on('log', (entry) => {
  state.logs.unshift(entry);
  if (state.logs.length > 500) state.logs.pop();
  if (!state.logsPaused) appendLog(entry);
});

// ── Load initial state ────────────────────────────────────
(async () => {
  const s = await window.leverler.getState();
  state.isRunning  = s.isRunning;
  state.agents     = s.agents   || [];
  state.triggers   = s.triggers || [];
  state.config     = s.config   || state.config;
  state.queueDepth = s.queueDepth || 0;
  state.stats      = {
    ...s.stats,
    active: (s.agents || []).filter(a => a.status === 'running').length,
  };
  updateRunningState(s.isRunning);
  loadSettingsIntoForm(s.config);
  renderAll();
})();

// ── Render all ────────────────────────────────────────────
function renderAll() {
  renderStats();
  renderDashboardAgents();
  renderTriggers();
  renderAgentGrids();
}

// ── Stats ─────────────────────────────────────────────────
function renderStats() {
  $('stat-triggered').textContent = state.stats.triggered;
  $('stat-completed').textContent = state.stats.completed;
  $('stat-failed').textContent    = state.stats.failed;
  $('stat-active').textContent    = state.stats.active;
  $('stat-queued').textContent    = state.queueDepth;
  $('triggerCount').textContent   = state.triggers.filter(t => t.enabled).length;
  $('agentCount').textContent     = state.stats.active;
}

// ── Running state ─────────────────────────────────────────
function updateRunningState(running) {
  const btn = $('startStopBtn');
  document.body.classList.toggle('leverler-active', running);
  // keep CSS class same name as before for the animations
  document.body.classList.toggle('conductor-active', running);
  btn.classList.toggle('running', running);
  btn.innerHTML = running
    ? '<span class="btn-icon">■</span><span class="btn-label">Stop Listening</span>'
    : '<span class="btn-icon">▶</span><span class="btn-label">Start Listening</span>';
  $('statusLabel').textContent  = running ? 'LISTENING' : 'IDLE';
  $('radarLabel').textContent   = running ? 'ACTIVE'    : 'IDLE';
  $('uptime').textContent = running
    ? `Started ${new Date().toLocaleTimeString()} · ${state.config.ollamaModel}`
    : 'Leverler not running';
}

// ── Dashboard agents ──────────────────────────────────────
function renderDashboardAgents() {
  const list   = $('activeAgentList');
  const active = state.agents.filter(a => a.status === 'running').slice(0, 5);
  if (!active.length) {
    list.innerHTML = '<div class="empty-state">No agents running</div>';
    return;
  }
  list.innerHTML = '';
  active.forEach(a => {
    const row = el('div', `agent-row ${a.status}`);
    row.innerHTML = `
      <div class="agent-row-name">${escHtml(a.name)}</div>
      <div class="agent-row-status"><span class="spin">⟳</span> running</div>`;
    row.addEventListener('click', () => openAgentModal(a.id));
    list.appendChild(row);
  });
}

// ── Triggers ──────────────────────────────────────────────
function renderTriggers() {
  const list = $('triggerList');
  if (!state.triggers.length) {
    list.innerHTML = '<div class="empty-state">No triggers configured. Add one to start.</div>';
    return;
  }
  list.innerHTML = '';
  state.triggers.forEach(t => {
    const card = el('div', 'trigger-card');
    card.innerHTML = `
      <div class="trigger-info">
        <div class="trigger-name">${escHtml(t.name)}</div>
        <div class="trigger-meta">
          Agent: ${t.agentType} &nbsp;·&nbsp;
          Keywords: ${(t.keywords||[]).slice(0,3).map(escHtml).join(', ') || 'any'}
        </div>
      </div>
      <span class="trigger-type-badge type-${t.type}">${t.type.toUpperCase()}</span>
      <div class="trigger-actions">
        <label class="toggle">
          <input type="checkbox" ${t.enabled ? 'checked' : ''} data-tid="${t.id}" />
          <span class="toggle-slider"></span>
        </label>
        <button class="btn-icon-sm" data-del="${t.id}">✕</button>
      </div>`;

    card.querySelector(`[data-tid="${t.id}"]`).addEventListener('change', async (e) => {
      await window.leverler.updateTrigger(t.id, { enabled: e.target.checked });
      const idx = state.triggers.findIndex(x => x.id === t.id);
      if (idx !== -1) state.triggers[idx].enabled = e.target.checked;
      renderStats();
    });

    card.querySelector(`[data-del="${t.id}"]`).addEventListener('click', async () => {
      if (!confirm(`Delete trigger "${t.name}"?`)) return;
      await window.leverler.removeTrigger(t.id);
      state.triggers = state.triggers.filter(x => x.id !== t.id);
      renderAll();
    });

    list.appendChild(card);
  });
}

// ── Agent grids ───────────────────────────────────────────
function renderAgentGrids() {
  renderAgentGrid($('agents-running'), state.agents.filter(a => a.status === 'running'), 'No agents running.');
  renderAgentGrid($('agents-history'), state.agents.filter(a => a.status !== 'running'), 'No completed agents yet.');
}

function renderAgentGrid(container, agents, emptyMsg) {
  if (!agents.length) {
    container.innerHTML = `<div class="empty-state">${emptyMsg}</div>`;
    return;
  }
  container.innerHTML = '';
  agents.forEach(a => {
    const card    = el('div', `agent-card ${a.status}`);
    const dur     = a.endTime ? msToHuman(a.endTime - a.startTime) : 'running…';
    const preview = a.result || a.error || (a.progress?.at(-1)?.msg) || 'Working…';
    card.innerHTML = `
      <div class="agent-card-header">
        <div class="agent-card-name">${escHtml(a.name)}</div>
        <div class="status-dot ${a.status}"></div>
      </div>
      <div class="agent-card-meta">
        ${a.type.toUpperCase()} · triggered by ${escHtml(a.triggeredBy)} · ${dur}
      </div>
      <div class="agent-card-preview">${escHtml(preview)}</div>
      ${a.status === 'running' ? `<div class="running-indicator">
        <div class="running-dots"><span></span><span></span><span></span></div>
        generating locally
      </div>` : ''}
      ${a.status === 'error' ? `<button class="btn-ghost btn-retry" data-retry="${a.id}" style="margin-top:8px;font-size:11px">↺ Retry</button>` : ''}`;
    card.querySelector(`[data-retry="${a.id}"]`)?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.leverler.retryAgent(a.id);
    });
    card.addEventListener('click', () => openAgentModal(a.id));
    container.appendChild(card);
  });
}

// ── Agent detail modal ────────────────────────────────────
let openAgentId = null;

function openAgentModal(id) {
  const a = state.agents.find(x => x.id === id);
  if (!a) return;
  openAgentId = id;
  $('agentModalTitle').textContent = a.name;
  $('agentDetailMeta').innerHTML = `
    Type: ${a.type} &nbsp;·&nbsp; Status: <strong>${a.status}</strong> &nbsp;·&nbsp;
    Triggered by: ${escHtml(a.triggeredBy)} &nbsp;·&nbsp;
    ${a.endTime ? `Duration: ${msToHuman(a.endTime - a.startTime)}` : 'Running…'}`;
  renderAgentDetailProgress(a);
  $('agentDetailResult').textContent = a.result || a.error || '(pending…)';
  $('agentModal').classList.remove('hidden');
}

function renderAgentDetailProgress(a) {
  const el = $('agentDetailProgress');
  if (!a.progress?.length) { el.innerHTML = ''; return; }
  el.innerHTML = a.progress.slice(-10).map(p => `<div>› ${escHtml(p.msg)}</div>`).join('');
}

function updateAgentDetailIfOpen(id) {
  if (openAgentId !== id) return;
  const a = state.agents.find(x => x.id === id);
  if (!a) return;
  renderAgentDetailProgress(a);
  $('agentDetailResult').textContent = a.result || a.error || '(pending…)';
}

// ── Logs ──────────────────────────────────────────────────
function appendLog(entry) {
  const stream = $('logStream');
  const line = el('div', `log-line level-${entry.level || 'info'}`);
  line.innerHTML = `
    <span class="log-time">${fmtTime(entry.time)}</span>
    <span class="log-level">${(entry.level || 'info').toUpperCase()}</span>
    <span class="log-msg">${escHtml(entry.message)}</span>`;
  stream.prepend(line);
  while (stream.children.length > 300) stream.removeChild(stream.lastChild);
}

$('clearLogsBtn').addEventListener('click', () => { $('logStream').innerHTML = ''; state.logs = []; });
$('pauseLogsBtn').addEventListener('click', () => {
  state.logsPaused = !state.logsPaused;
  $('pauseLogsBtn').textContent = state.logsPaused ? 'Resume' : 'Pause';
  if (!state.logsPaused) {
    $('logStream').innerHTML = '';
    state.logs.slice(0, 100).forEach(appendLog);
  }
});

// ── Events ────────────────────────────────────────────────
function addEvent(msg) {
  const list  = $('eventList');
  const empty = list.querySelector('.empty-state');
  if (empty) empty.remove();
  const row = el('div', 'event-row');
  row.innerHTML = `<span class="event-time">${fmtTime(Date.now())}</span><span class="event-msg">${escHtml(msg)}</span>`;
  list.prepend(row);
  while (list.children.length > 6) list.removeChild(list.lastChild);
}

// ── Trigger modal ─────────────────────────────────────────
$('addTriggerBtn').addEventListener('click', () => $('triggerModal').classList.remove('hidden'));
$('t_type').addEventListener('change', () => {
  $('emailFields').classList.toggle('hidden', $('t_type').value !== 'email');
});

$('saveTriggerBtn').addEventListener('click', async () => {
  const name = $('t_name').value.trim();
  if (!name) { alert('Please enter a trigger name.'); return; }
  const keywords = $('t_keywords').value.split(',').map(s => s.trim()).filter(Boolean);
  const type     = $('t_type').value;
  const trigger  = {
    name, type, keywords,
    agentType:   $('t_agentType').value,
    agentPrompt: $('t_prompt').value.trim(),
  };
  if (type === 'email') {
    trigger.emailConfig    = { host: $('t_imapHost').value.trim(), user: $('t_imapUser').value.trim(), pass: $('t_imapPass').value, port: 993 };
    trigger.pollIntervalSec = parseInt($('t_pollSec').value) || 120;
  }
  const saved = await window.leverler.addTrigger(trigger);
  state.triggers.push(saved);
  renderAll();
  $('triggerModal').classList.add('hidden');
  ['t_name','t_keywords','t_imapHost','t_imapUser','t_imapPass','t_prompt'].forEach(id => $(id).value = '');
  $('t_type').value = 'keyword'; $('t_agentType').value = 'custom';
  $('emailFields').classList.add('hidden');
});

// ── Launch agent modal ────────────────────────────────────
$('launchAgentBtn').addEventListener('click', () => $('launchModal').classList.remove('hidden'));
$('launchAgentConfirmBtn').addEventListener('click', async () => {
  const type    = $('la_type').value;
  const prompt  = $('la_prompt').value.trim();
  const context = $('la_context').value.trim();
  if (!prompt) { alert('Please enter a task for the agent.'); return; }
  $('launchModal').classList.add('hidden');
  await window.leverler.launchAgent({ type, prompt, context: context || null, name: `Manual ${type} agent` });
  document.querySelector('[data-view="agents"]').click();
  $('la_prompt').value = ''; $('la_context').value = '';
});

// ── Settings ──────────────────────────────────────────────
function loadSettingsIntoForm(cfg) {
  if (!cfg) return;
  if (cfg.ollamaHost)  $('ollamaHost').value  = cfg.ollamaHost;
  if (cfg.ollamaModel) {
    const sel = $('ollamaModel');
    const opt = [...sel.options].find(o => o.value === cfg.ollamaModel);
    if (opt) sel.value = cfg.ollamaModel;
    else {
      sel.value = 'custom';
      $('ollamaModelCustom').value = cfg.ollamaModel;
      $('ollamaModelCustom').classList.remove('hidden');
    }
  }
  if (cfg.ollamaTemperature !== undefined) {
    $('ollamaTemp').value = cfg.ollamaTemperature;
    $('tempDisplay').textContent = cfg.ollamaTemperature;
  }
  if (cfg.maxConcurrentAgents) $('maxAgents').value = cfg.maxConcurrentAgents;
}

$('ollamaModel').addEventListener('change', () => {
  $('ollamaModelCustom').classList.toggle('hidden', $('ollamaModel').value !== 'custom');
});

$('ollamaTemp').addEventListener('input', () => {
  $('tempDisplay').textContent = $('ollamaTemp').value;
});

// Ollama connection test
$('checkOllamaBtn').addEventListener('click', async () => {
  const statusEl = $('ollamaStatus');
  statusEl.className = 'ollama-status checking';
  statusEl.textContent = 'Checking connection…';

  // Update host first
  await window.leverler.setConfig({ ollamaHost: $('ollamaHost').value.trim() });

  const result = await window.leverler.checkOllama();
  if (result.ok) {
    statusEl.className = 'ollama-status ok';
    statusEl.textContent = `✓ Connected — ${result.models.length} model(s) available`;

    // Populate model dropdown with discovered models
    if (result.models.length > 0) {
      $('availableModels').textContent = `Available: ${result.models.join(', ')}`;
    }
  } else {
    statusEl.className = 'ollama-status err';
    statusEl.textContent = `✗ ${result.error}`;
  }
});

$('saveSettingsBtn').addEventListener('click', async () => {
  const modelSel   = $('ollamaModel').value;
  const model      = modelSel === 'custom' ? $('ollamaModelCustom').value.trim() : modelSel;
  const cfg = {
    ollamaHost:          $('ollamaHost').value.trim(),
    ollamaModel:         model || 'qwen2.5:7b',
    ollamaTemperature:   parseFloat($('ollamaTemp').value),
    maxConcurrentAgents: parseInt($('maxAgents').value),
  };
  await window.leverler.setConfig(cfg);
  state.config = { ...state.config, ...cfg };
  addEvent(`Settings saved — model: ${cfg.ollamaModel}`);
  if (state.isRunning) $('uptime').textContent = `Running · ${cfg.ollamaModel}`;
});

// ── Modal close ───────────────────────────────────────────
document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.modal;
    if (id) $(id).classList.add('hidden');
    if (id === 'agentModal') openAgentId = null;
  });
});

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.add('hidden');
      if (overlay.id === 'agentModal') openAgentId = null;
    }
  });
});

// ── Utilities ─────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtTime(ts) {
  return new Date(ts||Date.now()).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
}
function msToHuman(ms) {
  if (ms < 1000)  return `${ms}ms`;
  if (ms < 60000) return `${(ms/1000).toFixed(1)}s`;
  return `${Math.floor(ms/60000)}m ${Math.floor((ms%60000)/1000)}s`;
}
