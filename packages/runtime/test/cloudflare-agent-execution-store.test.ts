import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
	createSqlAgentExecutionStore,
	createSqlSessionStore,
} from '../src/cloudflare/agent-execution-store.ts';
import type { DirectAgentSubmissionInput } from '../src/runtime/agent-submissions.ts';
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

function directInput(overrides: Partial<DirectAgentSubmissionInput> = {}): DirectAgentSubmissionInput {
	return {
		kind: 'direct',
		submissionId: 'direct-1',
		agent: 'assistant',
		id: 'agent-1',
		session: 'default',
		payload: { message: 'Hello' },
		acceptedAt: '2026-06-03T00:00:00.000Z',
		...overrides,
	};
}

function attempt(submissionId: string, attemptId: string) {
	return { submissionId, attemptId };
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
			{ name: 'session_key' },
			{ name: 'kind' },
			{ name: 'payload' },
			{ name: 'status' },
			{ name: 'accepted_at' },
			{ name: 'attempt_id' },
			{ name: 'input_applied_at' },
			{ name: 'recovery_requested_at' },
			{ name: 'started_at' },
			{ name: 'settled_at' },
			{ name: 'error' },
			{ name: 'attempt_count' },
			{ name: 'max_retry' },
			{ name: 'timeout_at' },
		]);
		expect(
			db.prepare("SELECT name FROM pragma_table_info('flue_agent_turn_journals') ORDER BY cid").all(),
		).toEqual([
			{ name: 'submission_id' },
			{ name: 'session_key' },
			{ name: 'kind' },
			{ name: 'attempt_id' },
			{ name: 'operation_id' },
			{ name: 'turn_id' },
			{ name: 'phase' },
			{ name: 'revision' },
			{ name: 'created_at' },
			{ name: 'updated_at' },
			{ name: 'checkpoint_leaf_id' },
			{ name: 'tool_request_json' },
			{ name: 'stream_key' },
			{ name: 'stream_consumed_at' },
			{ name: 'committed' },
			{ name: 'committed_leaf_id' },
		]);
		expect(
			db
			.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
			.all(),
		).toEqual([
			{ name: 'flue_agent_dispatch_receipts' },
			{ name: 'flue_agent_session_deletions' },
			{ name: 'flue_agent_stream_chunks' },
			{ name: 'flue_agent_submissions' },
			{ name: 'flue_agent_turn_journals' },
			{ name: 'flue_sessions' },
			{ name: 'sqlite_sequence' },
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
		expect(
			db
				.prepare(
					"SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'flue_agent_dispatch_receipts' ORDER BY name",
				)
				.all(),
		).toEqual([
			{ name: 'sqlite_autoindex_flue_agent_dispatch_receipts_1' },
		]);
		expect(
			db
				.prepare(
					"SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'flue_agent_turn_journals' ORDER BY name",
				)
				.all(),
		).toEqual([
			{ name: 'sqlite_autoindex_flue_agent_turn_journals_1' },
		]);
	});

	it('admits one queued dispatch row when the same submission is replayed', async () => {
		const { db, sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');

		const first = await store.submissions.admitDispatch(dispatchInput());
		const replay = await store.submissions.admitDispatch(dispatchInput());

		expect(replay).toEqual(first);
		expect(db.prepare('SELECT COUNT(*) AS count FROM flue_agent_submissions').get()).toEqual({
			count: 1,
		});
		expect(first).toMatchObject({
			kind: 'submission',
			submission: {
				submissionId: 'dispatch-1',
				sessionKey: 'agent-session:["agent-1","default","default"]',
				status: 'queued',
			},
		});
	});

	it('returns conflict when one dispatch id is reused with another payload', async () => {
		const { sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		await store.submissions.admitDispatch(dispatchInput());

		expect(await store.submissions.admitDispatch(dispatchInput({ input: { text: 'Different' } }))).toEqual({
			kind: 'conflict',
		});
	});

	it('orders direct and dispatched submissions together within one session', async () => {
		const { sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		const direct = await store.submissions.admitDirect(directInput());
		await store.submissions.admitDispatch(dispatchInput());
		const other = await store.submissions.admitDirect(directInput({ submissionId: 'direct-2', session: 'other' }));

		expect(await store.submissions.listRunnableSubmissions()).toEqual([direct, other]);
		expect(await store.submissions.claimSubmission(attempt('dispatch-1', 'attempt-blocked'))).toBeNull();
		expect(await store.submissions.claimSubmission(attempt('direct-1', 'attempt-direct'))).toMatchObject({
			kind: 'direct',
			status: 'running',
		});
	});

	it('lists queued dispatches in admission order and selects one runnable head per session', async () => {
		const { sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		await store.submissions.admitDispatch(dispatchInput());
		await store.submissions.admitDispatch(dispatchInput({ dispatchId: 'dispatch-2' }));
		await store.submissions.admitDispatch(dispatchInput({ dispatchId: 'dispatch-3', session: 'other' }));

		expect(await store.submissions.listRunnableSubmissions()).toEqual([
			expect.objectContaining({ submissionId: 'dispatch-1' }),
			expect.objectContaining({ submissionId: 'dispatch-3' }),
		]);
	});

	it('claims only runnable session heads while allowing separate sessions to claim independently', async () => {
		const { sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		await store.submissions.admitDispatch(dispatchInput());
		await store.submissions.admitDispatch(dispatchInput({ dispatchId: 'dispatch-2' }));
		await store.submissions.admitDispatch(dispatchInput({ dispatchId: 'dispatch-3', session: 'other' }));

		const first = await store.submissions.claimSubmission(attempt('dispatch-1', 'attempt-1'));
		const blocked = await store.submissions.claimSubmission(attempt('dispatch-2', 'attempt-2'));
		const other = await store.submissions.claimSubmission(attempt('dispatch-3', 'attempt-3'));

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
		expect(await store.submissions.listRunningSubmissions()).toEqual([first, other]);
		expect(await store.submissions.listRunnableSubmissions()).toEqual([]);
	});

	it('terminalizes malformed queued payloads while returning healthy runnable rows', async () => {
		const { db, sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		await store.submissions.admitDispatch(dispatchInput({ dispatchId: 'healthy' }));
		db.prepare(
			`INSERT INTO flue_agent_submissions
			 (submission_id, session_key, kind, payload, status, accepted_at)
			 VALUES (?, ?, 'dispatch', ?, 'queued', ?)`,
		).run('malformed', 'agent-session:["agent-1","default","other"]', '{', 1);

		expect(await store.submissions.listRunnableSubmissions()).toEqual([
			expect.objectContaining({ submissionId: 'healthy' }),
		]);
		expect(
			db
				.prepare('SELECT status, error FROM flue_agent_submissions WHERE submission_id = ?')
				.get('malformed'),
		).toMatchObject({ status: 'settled', error: expect.any(String) });
	});

	it('terminalizes impossible queued input markers instead of replaying them', async () => {
		const { db, sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		await store.submissions.admitDispatch(dispatchInput());
		db.prepare('UPDATE flue_agent_submissions SET input_applied_at = ? WHERE submission_id = ?').run(
			1,
			'dispatch-1',
		);

		expect(await store.submissions.listRunnableSubmissions()).toEqual([]);
		expect(await store.submissions.getSubmission('dispatch-1')).toMatchObject({
			status: 'settled',
			error: expect.any(String),
		});
	});

	it('records input application and recovery requests only for the owning running attempt', async () => {
		const { sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		await store.submissions.admitDispatch(dispatchInput());
		await store.submissions.claimSubmission(attempt('dispatch-1', 'attempt-1'));

		expect(
			await store.submissions.beginTurnJournal({
				submissionId: 'dispatch-1',
				sessionKey: 'agent-session:["agent-1","default","default"]',
				kind: 'dispatch',
				attemptId: 'attempt-1',
				operationId: 'op-1',
				turnId: 'turn-1',
				phase: 'before_provider',
			}),
		).toBe(true);
		expect(await store.submissions.updateTurnJournalPhase(attempt('dispatch-1', 'attempt-1'), 'provider_started')).toBe(true);
		expect(await store.submissions.commitTurnJournal(attempt('dispatch-1', 'attempt-1'), 'leaf-1')).toBe(true);
		expect(await store.submissions.commitTurnJournal(attempt('dispatch-1', 'attempt-1'), 'leaf-1')).toBe(false);
		expect(await store.submissions.getTurnJournal('dispatch-1')).toMatchObject({
			phase: 'committed',
			committed: true,
			committedLeafId: 'leaf-1',
		});
		expect(
			await store.submissions.beginTurnJournal({
				submissionId: 'dispatch-1',
				sessionKey: 'agent-session:["agent-1","default","default"]',
				kind: 'dispatch',
				attemptId: 'attempt-1',
				operationId: 'op-2',
				turnId: 'turn-2',
				phase: 'before_provider',
			}),
		).toBe(true);
		expect(await store.submissions.getTurnJournal('dispatch-1')).toMatchObject({
			phase: 'before_provider',
			committed: false,
			operationId: 'op-2',
			turnId: 'turn-2',
		});

		expect(await store.submissions.markSubmissionInputApplied(attempt('dispatch-1', 'attempt-1'))).toBe(true);

		const appliedAt = (await store.submissions.getSubmission('dispatch-1'))?.inputAppliedAt;
		expect(await store.submissions.markSubmissionInputApplied(attempt('dispatch-1', 'attempt-1'))).toBe(true);
		expect(await store.submissions.markSubmissionInputApplied(attempt('dispatch-1', 'stale-attempt'))).toBe(false);
		expect(await store.submissions.requestSubmissionRecovery(attempt('dispatch-1', 'attempt-1'))).toBe(true);
		expect(await store.submissions.requestSubmissionRecovery(attempt('dispatch-1', 'stale-attempt'))).toBe(false);

		expect(appliedAt).toEqual(expect.any(Number));
		expect(await store.submissions.getSubmission('dispatch-1')).toMatchObject({
			status: 'running',
			attemptId: 'attempt-1',
			inputAppliedAt: appliedAt,
			recoveryRequestedAt: expect.any(Number),
		});
	});

	it('requeues interrupted attempts only before canonical input application', async () => {
		const { sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		await store.submissions.admitDispatch(dispatchInput({ dispatchId: 'requeue-safe' }));
		await store.submissions.admitDispatch(dispatchInput({ dispatchId: 'requeue-unsafe', session: 'other' }));
		await store.submissions.claimSubmission(attempt('requeue-safe', 'attempt-safe'));
		await store.submissions.claimSubmission(attempt('requeue-unsafe', 'attempt-unsafe'));
		await store.submissions.markSubmissionInputApplied(attempt('requeue-unsafe', 'attempt-unsafe'));

		const safe = await store.submissions.requeueSubmissionBeforeInputApplied(attempt('requeue-safe', 'attempt-safe'));
		const unsafe = await store.submissions.requeueSubmissionBeforeInputApplied(attempt('requeue-unsafe', 'attempt-unsafe'));

		expect(safe).toBe(true);
		expect(unsafe).toBe(false);
		expect(await store.submissions.getSubmission('requeue-safe')).toMatchObject({ status: 'queued' });
		expect(await store.submissions.getSubmission('requeue-safe')).not.toHaveProperty('attemptId');
		expect(await store.submissions.getSubmission('requeue-unsafe')).toMatchObject({ status: 'running' });
	});

	it('reports unsettled session visibility until a claimed dispatch completes', async () => {
		const { sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		await store.submissions.admitDispatch(dispatchInput({ session: 'case-1' }));

		expect(await store.submissions.hasUnsettledSubmissions()).toBe(true);
		expect(await store.submissions.listRunnableSubmissions()).toHaveLength(1);
		await store.submissions.claimSubmission(attempt('dispatch-1', 'attempt-1'));
		expect(await store.submissions.listRunningSubmissions()).toHaveLength(1);
		await store.submissions.completeSubmission(attempt('dispatch-1', 'attempt-1'));
		expect(await store.submissions.hasUnsettledSubmissions()).toBe(false);
		expect(await store.submissions.listRunningSubmissions()).toEqual([]);
		expect(await store.submissions.getSubmission('dispatch-1')).toMatchObject({ status: 'settled' });
	});

	it('ignores stale-attempt settlement and keeps the first owning terminal dispatch state', async () => {
		const { sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		await store.submissions.admitDispatch(dispatchInput());
		await store.submissions.claimSubmission(attempt('dispatch-1', 'attempt-1'));

		await store.submissions.completeSubmission(attempt('dispatch-1', 'stale-attempt'));
		await store.submissions.failSubmission(attempt('dispatch-1', 'attempt-1'), new Error('first failure'));
		await store.submissions.completeSubmission(attempt('dispatch-1', 'attempt-1'));
		await store.submissions.failSubmission(attempt('dispatch-1', 'attempt-1'), new Error('later failure'));

		expect(await store.submissions.getSubmission('dispatch-1')).toMatchObject({
			status: 'settled',
			error: 'first failure',
		});
	});

	it('rejects session deletion while durable submissions are queued or running', async () => {
		const { sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		await store.submissions.admitDispatch(dispatchInput());

		await expect(
			store.submissions.deleteSession('agent-session:["agent-1","default","default"]', async () => {}),
		).rejects.toThrow('Session cannot be deleted while durable agent submissions are queued or running.');

		await store.submissions.claimSubmission(attempt('dispatch-1', 'attempt-1'));
		await expect(
			store.submissions.deleteSession('agent-session:["agent-1","default","default"]', async () => {}),
		).rejects.toThrow('Session cannot be deleted while durable agent submissions are queued or running.');
	});

	it('blocks new submissions until session deletion completes', async () => {
		const { sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		const sessionKey = 'agent-session:["agent-1","default","default"]';
		let releaseDeletion: () => void = () => {};
		const deletionReleased = new Promise<void>((resolve) => {
			releaseDeletion = resolve;
		});

		const deletion = store.submissions.deleteSession(sessionKey, () => deletionReleased);
		await expect(store.submissions.admitDispatch(dispatchInput())).rejects.toThrow(
			'Durable agent submission admission is unavailable while this session is being deleted.',
		);
		releaseDeletion();
		await deletion;
		expect(await store.submissions.admitDispatch(dispatchInput())).toMatchObject({ kind: 'submission', submission: { status: 'queued' } });
	});

	it('shares session deletion work while snapshot deletion is in progress', async () => {
		const { sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		const sessionKey = 'agent-session:["agent-1","default","default"]';
		let releaseDeletion: () => void = () => {};
		const deletionReleased = new Promise<void>((resolve) => {
			releaseDeletion = resolve;
		});
		let deletionCalls = 0;

		const first = store.submissions.deleteSession(sessionKey, async () => {
			deletionCalls += 1;
			await deletionReleased;
		});
		const second = store.submissions.deleteSession(sessionKey, async () => {
			deletionCalls += 1;
		});

		expect(second).toBe(first);
		expect(deletionCalls).toBe(1);
		await expect(store.submissions.admitDispatch(dispatchInput())).rejects.toThrow(
			'Durable agent submission admission is unavailable while this session is being deleted.',
		);
		releaseDeletion();
		await Promise.all([first, second]);
		expect(await store.submissions.admitDispatch(dispatchInput())).toMatchObject({ kind: 'submission', submission: { status: 'queued' } });
	});

	it('keeps new submissions blocked when session snapshot deletion fails', async () => {
		const { sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		const sessionKey = 'agent-session:["agent-1","default","default"]';

		await expect(
			store.submissions.deleteSession(sessionKey, async () => {
				throw new Error('snapshot deletion failed');
			}),
		).rejects.toThrow('snapshot deletion failed');
		await expect(store.submissions.admitDispatch(dispatchInput())).rejects.toThrow(
			'Durable agent submission admission is unavailable while this session is being deleted.',
		);
		await expect(store.submissions.deleteSession(sessionKey, async () => {})).resolves.toBeUndefined();
		expect(await store.submissions.admitDispatch(dispatchInput())).toMatchObject({ kind: 'submission', submission: { status: 'queued' } });
	});

	it('clears terminal rows when a settled session is deleted', async () => {
		const { db, sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		const sessionKey = 'agent-session:["agent-1","default","default"]';
		await store.submissions.admitDispatch(dispatchInput());
		await store.submissions.claimSubmission(attempt('dispatch-1', 'attempt-1'));
		await store.submissions.completeSubmission(attempt('dispatch-1', 'attempt-1'));

		await store.submissions.deleteSession(sessionKey, async () => {});

		expect(await store.submissions.getSubmission('dispatch-1')).toBeNull();
		expect(
			db.prepare('SELECT dispatch_id, accepted_at FROM flue_agent_dispatch_receipts WHERE dispatch_id = ?').get(
				'dispatch-1',
			),
		).toEqual({
			dispatch_id: 'dispatch-1',
			accepted_at: Date.parse('2026-06-03T00:00:00.000Z'),
		});
	});

	it('returns retained receipt admission transactionally when deletion removed the settled dispatch row', async () => {
		const { sql, transactionSync } = makeFakeSql();
		const store = createSqlAgentExecutionStore({ sql, transactionSync }, 'FlueAssistantAgent');
		const sessionKey = 'agent-session:["agent-1","default","default"]';
		await store.submissions.admitDispatch(dispatchInput());
		await store.submissions.claimSubmission(attempt('dispatch-1', 'attempt-1'));
		await store.submissions.completeSubmission(attempt('dispatch-1', 'attempt-1'));
		await store.submissions.deleteSession(sessionKey, async () => {});

		expect(await store.submissions.admitDispatch(dispatchInput())).toEqual({
			kind: 'retained_receipt',
			receipt: {
				submissionId: 'dispatch-1',
				acceptedAt: Date.parse('2026-06-03T00:00:00.000Z'),
			},
		});
		expect(await store.submissions.getSubmission('dispatch-1')).toBeNull();
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
