// Minimaler D1 Ersatz über node:sqlite für lokale Tests.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function makeD1() {
  const db = new DatabaseSync(':memory:');
  const norm = (rows) => rows.map((r) => ({ ...r }));
  class Stmt {
    constructor(sql, args = []) { this.sql = sql; this.args = args; }
    bind(...args) {
      for (const a of args) if (a === undefined) throw new Error('D1_TYPE_ERROR: undefined bind in ' + this.sql);
      return new Stmt(this.sql, args);
    }
    async all() { return { results: norm(db.prepare(this.sql).all(...this.args)) }; }
    async first() { const r = db.prepare(this.sql).get(...this.args); return r ? { ...r } : null; }
    async run() { const r = db.prepare(this.sql).run(...this.args); return { success: true, meta: { changes: r.changes } }; }
    _exec() { return db.prepare(this.sql).run(...this.args); }
  }
  return {
    raw: db,
    prepare: (sql) => new Stmt(sql),
    async batch(list) {
      db.exec('BEGIN');
      try { const out = list.map((s) => s._exec()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
