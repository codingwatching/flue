import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
	createSqlAgentExecutionStore,
	createSqlSessionStore,
} from '../src/cloudflare/agent-execution-store.ts';
import type { SessionData } from '../src/types.ts';

function makeFakeSql() {
	const db = new DatabaseSync(':memory:');
	return {
		db,
		sql: {
			exec(query: string, ...bindings: unknown[]) {
				const stmt = db.prepare(query);
				let rows: unknown[];
				try {
					rows = stmt.all(...(bindings as never[]));
				} catch {
					stmt.run(...(bindings as never[]));
					rows = [];
				}
				return {
					toArray() {
						return rows as Record<string, unknown>[];
					},
				};
			},
		},
	};
}

function sessionData(): SessionData {
	return {
		version: 5,
		affinityKey: 'affinity-1',
		entries: [],
		leafId: null,
		metadata: {},
		createdAt: '2026-06-03T00:00:00.000Z',
		updatedAt: '2026-06-03T00:00:00.000Z',
	};
}

describe('createSqlAgentExecutionStore()', () => {
	it('loads, saves, and deletes existing flue_sessions rows when SQLite snapshot persistence is initialized', async () => {
		const { db, sql } = makeFakeSql();
		db.exec(
			'CREATE TABLE flue_sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)',
		);
		db.prepare('INSERT INTO flue_sessions (id, data, updated_at) VALUES (?, ?, ?)').run(
			'existing',
			JSON.stringify(sessionData()),
			1,
		);

		const store = createSqlAgentExecutionStore({ sql }, 'FlueAssistantAgent');

		expect(await store.sessions.load('existing')).toEqual(sessionData());
		await store.sessions.save('saved', sessionData());
		expect(await store.sessions.load('saved')).toEqual(sessionData());
		await store.sessions.delete('existing');
		expect(await store.sessions.load('existing')).toBeNull();
	});

	it('creates the initial flue_agent_submissions schema and ordering indexes when initialized', () => {
		const { db, sql } = makeFakeSql();

		createSqlAgentExecutionStore({ sql }, 'FlueAssistantAgent');

		expect(
			db.prepare("SELECT name FROM pragma_table_info('flue_agent_submissions') ORDER BY cid").all(),
		).toEqual([
			{ name: 'sequence' },
			{ name: 'submission_id' },
			{ name: 'session' },
			{ name: 'session_key' },
			{ name: 'kind' },
			{ name: 'payload' },
			{ name: 'status' },
			{ name: 'accepted_at' },
			{ name: 'attempt_id' },
			{ name: 'input_applied_at' },
			{ name: 'started_at' },
			{ name: 'completed_at' },
			{ name: 'error' },
		]);
		expect(
			db
				.prepare(
					"SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'flue_agent_submissions' ORDER BY name",
				)
				.all(),
		).toEqual([
			{ name: 'flue_agent_submissions_session_status_sequence_idx' },
			{ name: 'flue_agent_submissions_status_sequence_idx' },
			{ name: 'sqlite_autoindex_flue_agent_submissions_1' },
		]);
	});

	it('rejects missing Durable Object SQLite with migration guidance', () => {
		expect(() => createSqlAgentExecutionStore({}, 'FlueAssistantAgent')).toThrow(
			'Add "FlueAssistantAgent" to a Wrangler migration\'s "new_sqlite_classes" list before its first deploy; do not use legacy "new_classes". Existing KV-backed Durable Object classes cannot be converted to SQLite in place.',
		);
	});

	it('reports SQL initialization failures without misdiagnosing missing SQLite', () => {
		const { sql } = makeFakeSql();
		sql.exec('CREATE TABLE flue_agent_submissions (sequence INTEGER PRIMARY KEY AUTOINCREMENT)');

		expect(() => createSqlAgentExecutionStore({ sql }, 'FlueAssistantAgent')).toThrow(
			'[flue] Cloudflare durable agent class "FlueAssistantAgent" could not initialize its SQLite execution store. Underlying error: no such column: status',
		);
	});
});

describe('createSqlSessionStore()', () => {
	it('creates only flue_sessions when workflow-compatible snapshot persistence is initialized', () => {
		const { db, sql } = makeFakeSql();

		createSqlSessionStore(sql);

		expect(
			db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all(),
		).toEqual([{ name: 'flue_sessions' }]);
	});
});
