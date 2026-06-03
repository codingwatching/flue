import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
	createSqlAgentExecutionStore,
	createSqlSessionStore,
} from '../src/cloudflare/agent-execution-store.ts';
import type { DispatchInput } from '../src/runtime/dispatch-queue.ts';
import type { SessionData } from '../src/types.ts';

function makeFakeSql() {
	const db = new DatabaseSync(':memory:');
	return {
		db,
		transactionSync<T>(closure: () => T): T {
			db.exec('BEGIN');
			try {
				const result = closure();
				db.exec('COMMIT');
				return result;
			} catch (error) {
				db.exec('ROLLBACK');
				throw error;
			}
		},
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

function dispatchInput(overrides: Partial<DispatchInput> = {}): DispatchInput {
	return {
		dispatchId: 'dispatch-1',
		agent: 'assistant',
		id: 'agent-1',
		session: 'default',
		input: { text: 'Hello' },
		acceptedAt: '2026-06-03T00:00:00.000Z',
		...overrides,
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
		const { db, sql, transactionSync } = makeFakeSql();
		db.exec(
			'CREATE TABLE flue_sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)',
		);
		db.prepare('INSERT INTO flue_sessions (id, data, updated_at) VALUES (?, ?, ?)').run(
			'existing',
			JSON.stringify(sessionData()),
			1,
		);

		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');

		expect(await store.sessions.load('existing')).toEqual(sessionData());
		await store.sessions.save('saved', sessionData());
		expect(await store.sessions.load('saved')).toEqual(sessionData());
		await store.sessions.delete('existing');
		expect(await store.sessions.load('existing')).toBeNull();
	});

	it('creates the initial flue_agent_submissions schema and ordering indexes when initialized', () => {
		const { db, sql, transactionSync } = makeFakeSql();

		createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');

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
			{ name: 'recovery_requested_at' },
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

	it('adds recovery columns when an existing submission table predates the current schema', () => {
		const { db, sql, transactionSync } = makeFakeSql();
		db.exec(`CREATE TABLE flue_agent_submissions (
		 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
		 submission_id TEXT NOT NULL UNIQUE,
		 session TEXT NOT NULL,
		 session_key TEXT NOT NULL,
		 kind TEXT NOT NULL,
		 payload TEXT NOT NULL,
		 status TEXT NOT NULL,
		 accepted_at INTEGER NOT NULL,
		 attempt_id TEXT,
		 started_at INTEGER,
		 completed_at INTEGER,
		 error TEXT
		)`);

		createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');

		expect(
			db.prepare("SELECT name FROM pragma_table_info('flue_agent_submissions') ORDER BY cid").all(),
		).toContainEqual({ name: 'input_applied_at' });
		expect(
			db.prepare("SELECT name FROM pragma_table_info('flue_agent_submissions') ORDER BY cid").all(),
		).toContainEqual({ name: 'recovery_requested_at' });
	});

	it('admits one queued dispatch row when the same submission is replayed', () => {
		const { db, sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');

		const first = store.submissions.admitDispatch(dispatchInput());
		const replay = store.submissions.admitDispatch(dispatchInput());

		expect(replay).toEqual(first);
		expect(db.prepare('SELECT COUNT(*) AS count FROM flue_agent_submissions').get()).toEqual({
			count: 1,
		});
		expect(first).toMatchObject({
			submissionId: 'dispatch-1',
			session: 'default',
			sessionKey: 'agent-session:["agent-1","default","default"]',
			status: 'queued',
		});
	});

	it('rejects conflicting replay when one dispatch id is reused with another payload', () => {
		const { sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		store.submissions.admitDispatch(dispatchInput());

		expect(() =>
			store.submissions.admitDispatch(dispatchInput({ input: { text: 'Different' } })),
		).toThrow('[flue] Conflicting internal dispatch replay.');
	});

	it('lists queued dispatches in admission order and selects one runnable head per session', () => {
		const { sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		const first = store.submissions.admitDispatch(dispatchInput());
		const second = store.submissions.admitDispatch(dispatchInput({ dispatchId: 'dispatch-2' }));
		const other = store.submissions.admitDispatch(
			dispatchInput({ dispatchId: 'dispatch-3', session: 'other' }),
		);

		expect(store.submissions.listQueuedDispatches()).toEqual([first, second, other]);
		expect(store.submissions.listRunnableDispatches()).toEqual([first, other]);
	});

	it('claims only runnable session heads while allowing separate sessions to claim independently', () => {
		const { sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		store.submissions.admitDispatch(dispatchInput());
		store.submissions.admitDispatch(dispatchInput({ dispatchId: 'dispatch-2' }));
		store.submissions.admitDispatch(dispatchInput({ dispatchId: 'dispatch-3', session: 'other' }));

		const first = store.submissions.claimDispatch('dispatch-1', 'attempt-1');
		const blocked = store.submissions.claimDispatch('dispatch-2', 'attempt-2');
		const other = store.submissions.claimDispatch('dispatch-3', 'attempt-3');

		expect(first).toMatchObject({
			submissionId: 'dispatch-1',
			status: 'running',
			attemptId: 'attempt-1',
			startedAt: expect.any(Number),
		});
		expect(blocked).toBeNull();
		expect(other).toMatchObject({
			submissionId: 'dispatch-3',
			status: 'running',
			attemptId: 'attempt-3',
		});
		expect(store.submissions.listRunningDispatches()).toEqual([first, other]);
		expect(store.submissions.listRunnableDispatches()).toEqual([]);
	});

	it('terminalizes malformed queued payloads while returning healthy runnable rows', () => {
		const { db, sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		store.submissions.admitDispatch(dispatchInput({ dispatchId: 'healthy' }));
		db.prepare(
			`INSERT INTO flue_agent_submissions
			 (submission_id, session, session_key, kind, payload, status, accepted_at)
			 VALUES (?, ?, ?, 'dispatch', ?, 'queued', ?)`,
		).run('malformed', 'other', 'agent-session:["agent-1","default","other"]', '{', 1);

		expect(store.submissions.listRunnableDispatches()).toEqual([
			expect.objectContaining({ submissionId: 'healthy' }),
		]);
		expect(
			db
				.prepare('SELECT status, error FROM flue_agent_submissions WHERE submission_id = ?')
				.get('malformed'),
		).toMatchObject({ status: 'error', error: expect.any(String) });
	});

	it('terminalizes impossible queued input markers instead of replaying them', () => {
		const { db, sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		store.submissions.admitDispatch(dispatchInput());
		db.prepare('UPDATE flue_agent_submissions SET input_applied_at = ? WHERE submission_id = ?').run(
			1,
			'dispatch-1',
		);

		expect(store.submissions.listRunnableDispatches()).toEqual([]);
		expect(store.submissions.getDispatch('dispatch-1')).toMatchObject({
			status: 'error',
			error: expect.any(String),
		});
	});

	it('adopts legacy dispatches ahead of existing SQL submissions in historical order', () => {
		const { sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		store.submissions.admitDispatch(dispatchInput({ dispatchId: 'current' }));

		const adopted = store.submissions.adoptLegacyDispatches([
			dispatchInput({ dispatchId: 'legacy-1' }),
			dispatchInput({ dispatchId: 'legacy-2' }),
		]);

		expect(adopted.map((submission) => submission.submissionId)).toEqual(['legacy-1', 'legacy-2']);
		expect(store.submissions.listQueuedDispatches().map((submission) => submission.submissionId)).toEqual([
			'legacy-1',
			'legacy-2',
			'current',
		]);
	});

	it('adopts more than sixteen legacy dispatches without exceeding the Cloudflare SQL binding limit', () => {
		const { sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		store.submissions.admitDispatch(dispatchInput({ dispatchId: 'current' }));
		const legacy = Array.from({ length: 17 }, (_, index) =>
			dispatchInput({ dispatchId: `legacy-${index + 1}` }),
		);

		store.submissions.adoptLegacyDispatches(legacy);

		expect(store.submissions.listQueuedDispatches().map((submission) => submission.submissionId)).toEqual([
			...legacy.map((input) => input.dispatchId),
			'current',
		]);
	});

	it('records input application and recovery requests only for the owning running attempt', () => {
		const { sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		store.submissions.admitDispatch(dispatchInput());
		store.submissions.claimDispatch('dispatch-1', 'attempt-1');

		const applied = store.submissions.markDispatchInputApplied('dispatch-1', 'attempt-1');
		const replay = store.submissions.markDispatchInputApplied('dispatch-1', 'attempt-1');
		const staleApplied = store.submissions.markDispatchInputApplied('dispatch-1', 'stale-attempt');
		const recovery = store.submissions.requestDispatchRecovery('dispatch-1', 'attempt-1');
		const staleRecovery = store.submissions.requestDispatchRecovery('dispatch-1', 'stale-attempt');

		expect(applied).toMatchObject({
			status: 'running',
			attemptId: 'attempt-1',
			inputAppliedAt: expect.any(Number),
		});
		expect(replay?.inputAppliedAt).toBe(applied?.inputAppliedAt);
		expect(staleApplied).toBeNull();
		expect(recovery).toMatchObject({ recoveryRequestedAt: expect.any(Number) });
		expect(staleRecovery).toBeNull();
	});

	it('requeues interrupted attempts only before canonical input application', () => {
		const { sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		store.submissions.admitDispatch(dispatchInput({ dispatchId: 'requeue-safe' }));
		store.submissions.admitDispatch(dispatchInput({ dispatchId: 'requeue-unsafe', session: 'other' }));
		store.submissions.claimDispatch('requeue-safe', 'attempt-safe');
		store.submissions.claimDispatch('requeue-unsafe', 'attempt-unsafe');
		store.submissions.markDispatchInputApplied('requeue-unsafe', 'attempt-unsafe');

		const safe = store.submissions.requeueDispatchBeforeInputApplied('requeue-safe', 'attempt-safe');
		const unsafe = store.submissions.requeueDispatchBeforeInputApplied('requeue-unsafe', 'attempt-unsafe');

		expect(safe).toMatchObject({ status: 'queued' });
		expect(safe).not.toHaveProperty('attemptId');
		expect(unsafe).toBeNull();
		expect(store.submissions.getDispatch('requeue-unsafe')).toMatchObject({ status: 'running' });
	});

	it('reports unsettled session visibility until a claimed dispatch completes', () => {
		const { sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		store.submissions.admitDispatch(dispatchInput({ session: 'case-1' }));

		expect(store.submissions.hasUnsettledDispatches()).toBe(true);
		expect(store.submissions.hasUnsettledDispatchForSession('agent-1', 'case-1')).toBe(true);
		expect(store.submissions.hasUnsettledDispatchForSession('agent-1', 'case-2')).toBe(false);
		store.submissions.claimDispatch('dispatch-1', 'attempt-1');
		expect(store.submissions.hasUnsettledDispatchForSession('agent-1', 'case-1')).toBe(true);
		store.submissions.completeDispatch('dispatch-1', 'attempt-1');
		expect(store.submissions.hasUnsettledDispatches()).toBe(false);
		expect(store.submissions.hasUnsettledDispatchForSession('agent-1', 'case-1')).toBe(false);
		expect(store.submissions.getDispatch('dispatch-1')).toMatchObject({ status: 'completed' });
	});

	it('ignores stale-attempt settlement and keeps the first owning terminal dispatch state', () => {
		const { sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		store.submissions.admitDispatch(dispatchInput());
		store.submissions.claimDispatch('dispatch-1', 'attempt-1');

		store.submissions.completeDispatch('dispatch-1', 'stale-attempt');
		store.submissions.failDispatch('dispatch-1', 'attempt-1', new Error('first failure'));
		store.submissions.completeDispatch('dispatch-1', 'attempt-1');
		store.submissions.failDispatch('dispatch-1', 'attempt-1', new Error('later failure'));

		expect(store.submissions.getDispatch('dispatch-1')).toMatchObject({
			status: 'error',
			error: 'first failure',
		});
	});

	it('rejects missing Durable Object SQLite with migration guidance', () => {
		expect(() => createSqlAgentExecutionStore({}, 'FlueAssistantAgent')).toThrow(
			'Add "FlueAssistantAgent" to a Wrangler migration\'s "new_sqlite_classes" list before its first deploy; do not use legacy "new_classes". Existing KV-backed Durable Object classes cannot be converted to SQLite in place.',
		);
	});

	it('rejects SQLite-compatible storage without synchronous transaction support', () => {
		const { sql } = makeFakeSql();

		expect(() => createSqlAgentExecutionStore({ sql }, 'FlueAssistantAgent')).toThrow(
			'[flue] Cloudflare durable agent class "FlueAssistantAgent" requires Durable Object SQLite.',
		);
	});

	it('reports SQL initialization failures without misdiagnosing missing SQLite', () => {
		const { sql, transactionSync } = makeFakeSql();
		sql.exec('CREATE TABLE flue_agent_submissions (sequence INTEGER PRIMARY KEY AUTOINCREMENT)');

		expect(() => createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent')).toThrow(
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
