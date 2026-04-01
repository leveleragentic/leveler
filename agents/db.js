const Database = require('better-sqlite3');
const path     = require('path');
const { app }  = require('electron');

class DB {
  constructor() {
    const dbPath = path.join(app.getPath('userData'), 'leverler.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this._migrate();
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        id           TEXT    PRIMARY KEY,
        name         TEXT    NOT NULL,
        type         TEXT    NOT NULL,
        status       TEXT    NOT NULL,
        triggered_by TEXT,
        start_time   INTEGER,
        end_time     INTEGER,
        result       TEXT,
        error        TEXT,
        progress     TEXT
      );

      CREATE TABLE IF NOT EXISTS agent_memory (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        scope      TEXT    NOT NULL UNIQUE,
        content    TEXT    NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_runs_start ON agent_runs(start_time DESC);
      CREATE INDEX IF NOT EXISTS idx_runs_status ON agent_runs(status);
    `);
  }

  // ── Agent runs ─────────────────────────────────────────────────────────
  saveRun(agent) {
    this.db.prepare(`
      INSERT OR REPLACE INTO agent_runs
        (id, name, type, status, triggered_by, start_time, end_time, result, error, progress)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      agent.id,
      agent.name,
      agent.type,
      agent.status,
      agent.triggeredBy  ?? null,
      agent.startTime    ?? null,
      agent.endTime      ?? null,
      agent.result       ?? null,
      agent.error        ?? null,
      JSON.stringify(agent.progress ?? [])
    );
  }

  listRuns({ limit = 50, offset = 0, search = '' } = {}) {
    let rows;
    if (search) {
      const like = `%${search}%`;
      rows = this.db.prepare(`
        SELECT * FROM agent_runs
        WHERE name LIKE ? OR triggered_by LIKE ? OR result LIKE ? OR error LIKE ?
        ORDER BY start_time DESC LIMIT ? OFFSET ?
      `).all(like, like, like, like, limit, offset);
    } else {
      rows = this.db.prepare(`
        SELECT * FROM agent_runs
        ORDER BY start_time DESC LIMIT ? OFFSET ?
      `).all(limit, offset);
    }
    return rows.map(r => ({ ...r, progress: JSON.parse(r.progress || '[]') }));
  }

  countRuns({ search = '' } = {}) {
    if (search) {
      const like = `%${search}%`;
      return this.db.prepare(`
        SELECT COUNT(*) AS n FROM agent_runs
        WHERE name LIKE ? OR triggered_by LIKE ? OR result LIKE ? OR error LIKE ?
      `).get(like, like, like, like).n;
    }
    return this.db.prepare('SELECT COUNT(*) AS n FROM agent_runs').get().n;
  }

  getRun(id) {
    const row = this.db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id);
    if (!row) return null;
    return { ...row, progress: JSON.parse(row.progress || '[]') };
  }

  deleteRun(id) {
    this.db.prepare('DELETE FROM agent_runs WHERE id = ?').run(id);
  }

  clearRuns() {
    this.db.prepare('DELETE FROM agent_runs').run();
  }

  // ── Memory ──────────────────────────────────────────────────────────────
  setMemory(scope, content) {
    if (!content || !content.trim()) {
      this.db.prepare('DELETE FROM agent_memory WHERE scope = ?').run(scope);
      return;
    }
    this.db.prepare(`
      INSERT INTO agent_memory (scope, content, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(scope) DO UPDATE SET content = excluded.content, created_at = excluded.created_at
    `).run(scope, content.trim(), Date.now());
  }

  getMemory(scope) {
    return this.db.prepare('SELECT content FROM agent_memory WHERE scope = ?').get(scope)?.content ?? '';
  }
}

module.exports = { DB };
