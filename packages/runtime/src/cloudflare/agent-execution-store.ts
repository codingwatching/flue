import type { SessionData, SessionStore } from '../types.ts';

interface SqlResult {
	toArray(): SqlRow[];
}

type SqlRow = Record<string, unknown>;

interface SqlStorage {
	exec(query: string, ...bindings: unknown[]): SqlResult;
}

interface DurableObjectStorage {
	readonly sql?: SqlStorage;
}

export interface SqlAgentExecutionStore {
	readonly sessions: SessionStore;
}

export function createSqlSessionStore(sql: SqlStorage): SessionStore {
	ensureSessionTable(sql);
	return new SqlSessionStore(sql);
}

export function createSqlAgentExecutionStore(
	storage: DurableObjectStorage | undefined,
	className: string,
): SqlAgentExecutionStore {
	const sql = storage?.sql;
	if (!sql || typeof sql.exec !== 'function') {
		throw new Error(
			`[flue] Cloudflare durable agent class "${className}" requires Durable Object SQLite. ` +
				`Add "${className}" to a Wrangler migration's "new_sqlite_classes" list before its first deploy; ` +
				`do not use legacy "new_classes". Existing KV-backed Durable Object classes cannot be converted ` +
				`to SQLite in place.`,
		);
	}
	try {
		const sessions = createSqlSessionStore(sql);
		ensureSubmissionTable(sql);
		return { sessions };
	} catch (cause) {
		const detail = cause instanceof Error ? cause.message : String(cause);
		throw new Error(
			`[flue] Cloudflare durable agent class "${className}" could not initialize its SQLite execution store. ` +
				`Underlying error: ${detail}`,
			{ cause },
		);
	}
}

class SqlSessionStore implements SessionStore {
	constructor(private sql: SqlStorage) {}

	async save(id: string, data: SessionData): Promise<void> {
		this.sql.exec(
			'INSERT OR REPLACE INTO flue_sessions (id, data, updated_at) VALUES (?, ?, ?)',
			id,
			JSON.stringify(data),
			Date.now(),
		);
	}

	async load(id: string): Promise<SessionData | null> {
		const rows = this.sql.exec('SELECT data FROM flue_sessions WHERE id = ?', id).toArray();
		const row = rows[0];
		if (!row) return null;
		if (typeof row.data !== 'string') throw new Error('[flue] Persisted session row is malformed.');
		return JSON.parse(row.data) as SessionData;
	}

	async delete(id: string): Promise<void> {
		this.sql.exec('DELETE FROM flue_sessions WHERE id = ?', id);
	}
}

function ensureSessionTable(sql: SqlStorage): void {
	sql.exec(
		`CREATE TABLE IF NOT EXISTS flue_sessions (
		 id TEXT PRIMARY KEY,
		 data TEXT NOT NULL,
		 updated_at INTEGER NOT NULL
		)`,
	);
}

function ensureSubmissionTable(sql: SqlStorage): void {
	sql.exec(
		`CREATE TABLE IF NOT EXISTS flue_agent_submissions (
		 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
		 submission_id TEXT NOT NULL UNIQUE,
		 session TEXT NOT NULL,
		 session_key TEXT NOT NULL,
		 kind TEXT NOT NULL,
		 payload TEXT NOT NULL,
		 status TEXT NOT NULL,
		 accepted_at INTEGER NOT NULL,
		 attempt_id TEXT,
		 input_applied_at INTEGER,
		 started_at INTEGER,
		 completed_at INTEGER,
		 error TEXT
		)`,
	);
	sql.exec(
		'CREATE INDEX IF NOT EXISTS flue_agent_submissions_status_sequence_idx ON flue_agent_submissions (status, sequence ASC)',
	);
	sql.exec(
		'CREATE INDEX IF NOT EXISTS flue_agent_submissions_session_status_sequence_idx ON flue_agent_submissions (session_key, status, sequence ASC)',
	);
}
