import type { DispatchInput } from '../runtime/dispatch-queue.ts';
import { createSessionStorageKey } from '../session-identity.ts';
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
	transactionSync?<T>(closure: () => T): T;
}

type SqlAgentSubmissionStatus = 'queued' | 'running' | 'completed' | 'error';

export interface SqlAgentDispatchSubmission {
	readonly sequence: number;
	readonly submissionId: string;
	readonly session: string;
	readonly sessionKey: string;
	readonly input: DispatchInput;
	readonly status: SqlAgentSubmissionStatus;
	readonly acceptedAt: number;
	readonly attemptId?: string;
	readonly inputAppliedAt?: number;
	readonly recoveryRequestedAt?: number;
	readonly startedAt?: number;
	readonly completedAt?: number;
	readonly error?: string;
}

export interface SqlAgentSubmissionStore {
	getDispatch(submissionId: string): SqlAgentDispatchSubmission | null;
	admitDispatch(input: DispatchInput): SqlAgentDispatchSubmission;
	adoptLegacyDispatches(inputs: readonly DispatchInput[]): SqlAgentDispatchSubmission[];
	hasUnsettledDispatches(): boolean;
	listQueuedDispatches(): SqlAgentDispatchSubmission[];
	listRunnableDispatches(): SqlAgentDispatchSubmission[];
	listRunningDispatches(): SqlAgentDispatchSubmission[];
	hasUnsettledDispatchForSession(instanceId: string, session: string): boolean;
	claimDispatch(submissionId: string, attemptId: string): SqlAgentDispatchSubmission | null;
	markDispatchInputApplied(submissionId: string, attemptId: string): SqlAgentDispatchSubmission | null;
	requestDispatchRecovery(submissionId: string, attemptId: string): SqlAgentDispatchSubmission | null;
	requeueDispatchBeforeInputApplied(
		submissionId: string,
		attemptId: string,
	): SqlAgentDispatchSubmission | null;
	completeDispatch(submissionId: string, attemptId: string): void;
	failDispatch(submissionId: string, attemptId: string, error: unknown): void;
}

export interface SqlAgentExecutionStore {
	readonly sessions: SessionStore;
	readonly submissions: SqlAgentSubmissionStore;
}

export class SqlAgentSubmissionConflictError extends Error {}

export function createSqlSessionStore(sql: SqlStorage): SessionStore {
	ensureSessionTable(sql);
	return new SqlSessionStore(sql);
}

export function createSqlAgentExecutionStore(
	storage: DurableObjectStorage | undefined,
	className: string,
): SqlAgentExecutionStore {
	const sql = storage?.sql;
	const transactionSync = storage?.transactionSync;
	if (!sql || typeof sql.exec !== 'function' || typeof transactionSync !== 'function') {
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
		const runTransaction = <T>(closure: () => T): T => transactionSync.call(storage, closure) as T;
		return {
			sessions,
			submissions: new SqlAgentSubmissionStoreImpl(sql, runTransaction),
		};
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

class SqlAgentSubmissionStoreImpl implements SqlAgentSubmissionStore {
	constructor(
		private sql: SqlStorage,
		private transactionSync: NonNullable<DurableObjectStorage['transactionSync']>,
	) {}

	getDispatch(submissionId: string): SqlAgentDispatchSubmission | null {
		const row = this.readDispatchRow(submissionId);
		return row ? parseDispatchSubmission(row) : null;
	}

	admitDispatch(input: DispatchInput): SqlAgentDispatchSubmission {
		const payload = JSON.stringify(input);
		const acceptedAt = Date.parse(input.acceptedAt);
		if (!Number.isFinite(acceptedAt)) {
			throw new Error('[flue] Internal dispatch admission received an invalid acceptedAt timestamp.');
		}
		this.sql.exec(
			`INSERT OR IGNORE INTO flue_agent_submissions
			 (submission_id, session, session_key, kind, payload, status, accepted_at)
			 VALUES (?, ?, ?, 'dispatch', ?, 'queued', ?)`,
			input.dispatchId,
			input.session,
			createSessionStorageKey(input.id, 'default', input.session),
			payload,
			acceptedAt,
		);
		const row = this.readDispatchRow(input.dispatchId);
		if (!row) throw new Error('[flue] Durable dispatch admission did not create a submission row.');
		if (row.payload !== payload) {
			throw new SqlAgentSubmissionConflictError('[flue] Conflicting internal dispatch replay.');
		}
		return parseDispatchSubmission(row);
	}

	adoptLegacyDispatches(inputs: readonly DispatchInput[]): SqlAgentDispatchSubmission[] {
		const unique = new Map<string, DispatchInput>();
		for (const input of inputs) {
			const payload = JSON.stringify(input);
			const row = this.readDispatchRow(input.dispatchId);
			if (row && row.payload !== payload) {
				throw new SqlAgentSubmissionConflictError('[flue] Conflicting legacy dispatch adoption.');
			}
			const prior = unique.get(input.dispatchId);
			if (prior && JSON.stringify(prior) !== payload) {
				throw new SqlAgentSubmissionConflictError('[flue] Conflicting legacy dispatch adoption.');
			}
			if (!prior) unique.set(input.dispatchId, input);
		}
		const missing = [...unique.values()].filter((input) => !this.readDispatchRow(input.dispatchId));
		const adopt = () => {
			const first = this.sql
				.exec('SELECT MIN(sequence) AS sequence FROM flue_agent_submissions')
				.toArray()[0]?.sequence;
			let sequence = typeof first === 'number' ? first - missing.length : -missing.length;
			for (let offset = 0; offset < missing.length; offset += 16) {
				const batch = missing.slice(offset, offset + 16);
				const values: unknown[] = [];
				for (const input of batch) {
					const acceptedAt = Date.parse(input.acceptedAt);
					if (!Number.isFinite(acceptedAt)) {
						throw new Error('[flue] Legacy dispatch adoption received an invalid acceptedAt timestamp.');
					}
					values.push(
						sequence++,
						input.dispatchId,
						input.session,
						createSessionStorageKey(input.id, 'default', input.session),
						JSON.stringify(input),
						acceptedAt,
					);
				}
				this.sql.exec(
					`INSERT INTO flue_agent_submissions
					 (sequence, submission_id, session, session_key, kind, payload, status, accepted_at)
					 VALUES ${batch.map(() => "(?, ?, ?, ?, 'dispatch', ?, 'queued', ?)").join(', ')}`,
					...values,
				);
			}
		};
		if (missing.length > 0) this.transactionSync(adopt);
		return inputs.map((input) => {
			const submission = this.getDispatch(input.dispatchId);
			if (!submission) throw new Error('[flue] Legacy dispatch adoption did not create a submission row.');
			return submission;
		});
	}

	hasUnsettledDispatches(): boolean {
		return (
			this.sql
				.exec(
					`SELECT 1
					 FROM flue_agent_submissions
					 WHERE kind = 'dispatch' AND status IN ('queued', 'running')
					 LIMIT 1`,
				)
				.toArray().length > 0
		);
	}

	listQueuedDispatches(): SqlAgentDispatchSubmission[] {
		return this.parseQueuedRows(
			this.sql
				.exec(
					`SELECT sequence, submission_id, session, session_key, kind, payload, status,
					        accepted_at, attempt_id, input_applied_at, recovery_requested_at, started_at, completed_at, error
					 FROM flue_agent_submissions
					 WHERE kind = 'dispatch' AND status = 'queued'
					 ORDER BY sequence ASC`,
				)
				.toArray(),
		);
	}

	listRunnableDispatches(): SqlAgentDispatchSubmission[] {
		const rows = this.sql
			.exec(
				`SELECT current.sequence, current.submission_id, current.session, current.session_key,
				        current.kind, current.payload, current.status, current.accepted_at,
				        current.attempt_id, current.input_applied_at, current.recovery_requested_at,
				        current.started_at, current.completed_at, current.error
				 FROM flue_agent_submissions AS current
				 WHERE current.kind = 'dispatch' AND current.status = 'queued'
				   AND NOT EXISTS (
				     SELECT 1
				     FROM flue_agent_submissions AS earlier
				     WHERE earlier.kind = 'dispatch'
				       AND earlier.session_key = current.session_key
				       AND earlier.status IN ('queued', 'running')
				       AND earlier.sequence < current.sequence
				   )
				 ORDER BY current.sequence ASC`,
			)
			.toArray();
		return this.parseQueuedRows(rows);
	}

	listRunningDispatches(): SqlAgentDispatchSubmission[] {
		return this.parseRunningRows(
			this.sql
				.exec(
					`SELECT sequence, submission_id, session, session_key, kind, payload, status,
					        accepted_at, attempt_id, input_applied_at, recovery_requested_at, started_at, completed_at, error
					 FROM flue_agent_submissions
					 WHERE kind = 'dispatch' AND status = 'running'
					 ORDER BY sequence ASC`,
				)
				.toArray(),
		);
	}

	hasUnsettledDispatchForSession(instanceId: string, session: string): boolean {
		return (
			this.sql
				.exec(
					`SELECT 1
					 FROM flue_agent_submissions
					 WHERE kind = 'dispatch' AND session_key = ? AND status IN ('queued', 'running')
					 LIMIT 1`,
					createSessionStorageKey(instanceId, 'default', session),
				)
				.toArray().length > 0
		);
	}

	claimDispatch(submissionId: string, attemptId: string): SqlAgentDispatchSubmission | null {
		this.sql.exec(
			`UPDATE flue_agent_submissions AS current
			 SET status = 'running', attempt_id = ?, started_at = ?
			 WHERE current.submission_id = ? AND current.kind = 'dispatch' AND current.status = 'queued'
			   AND NOT EXISTS (
			     SELECT 1
			     FROM flue_agent_submissions AS earlier
			     WHERE earlier.kind = 'dispatch'
			       AND earlier.session_key = current.session_key
			       AND earlier.status IN ('queued', 'running')
			       AND earlier.sequence < current.sequence
			   )`,
			attemptId,
			Date.now(),
			submissionId,
		);
		const submission = this.getDispatch(submissionId);
		return submission?.status === 'running' && submission.attemptId === attemptId
			? submission
			: null;
	}

	markDispatchInputApplied(submissionId: string, attemptId: string): SqlAgentDispatchSubmission | null {
		this.sql.exec(
			`UPDATE flue_agent_submissions
			 SET input_applied_at = COALESCE(input_applied_at, ?)
			 WHERE submission_id = ? AND kind = 'dispatch' AND status = 'running' AND attempt_id = ?`,
			Date.now(),
			submissionId,
			attemptId,
		);
		const submission = this.getDispatch(submissionId);
		return submission?.status === 'running' && submission.attemptId === attemptId
			? submission
			: null;
	}

	requestDispatchRecovery(submissionId: string, attemptId: string): SqlAgentDispatchSubmission | null {
		this.sql.exec(
			`UPDATE flue_agent_submissions
			 SET recovery_requested_at = COALESCE(recovery_requested_at, ?)
			 WHERE submission_id = ? AND kind = 'dispatch' AND status = 'running' AND attempt_id = ?`,
			Date.now(),
			submissionId,
			attemptId,
		);
		const submission = this.getDispatch(submissionId);
		return submission?.status === 'running' && submission.attemptId === attemptId
			? submission
			: null;
	}

	requeueDispatchBeforeInputApplied(
		submissionId: string,
		attemptId: string,
	): SqlAgentDispatchSubmission | null {
		this.sql.exec(
			`UPDATE flue_agent_submissions
			 SET status = 'queued', attempt_id = NULL, recovery_requested_at = NULL, started_at = NULL
			 WHERE submission_id = ? AND kind = 'dispatch' AND status = 'running'
			   AND attempt_id = ? AND input_applied_at IS NULL`,
			submissionId,
			attemptId,
		);
		const submission = this.getDispatch(submissionId);
		return submission?.status === 'queued' ? submission : null;
	}

	completeDispatch(submissionId: string, attemptId: string): void {
		this.sql.exec(
			`UPDATE flue_agent_submissions
			 SET status = 'completed', completed_at = ?, error = NULL
			 WHERE submission_id = ? AND kind = 'dispatch' AND status = 'running' AND attempt_id = ?`,
			Date.now(),
			submissionId,
			attemptId,
		);
	}

	failDispatch(submissionId: string, attemptId: string, error: unknown): void {
		this.sql.exec(
			`UPDATE flue_agent_submissions
			 SET status = 'error', completed_at = ?, error = ?
			 WHERE submission_id = ? AND kind = 'dispatch' AND status = 'running' AND attempt_id = ?`,
			Date.now(),
			error instanceof Error ? error.message : String(error),
			submissionId,
			attemptId,
		);
	}

	private parseQueuedRows(rows: SqlRow[]): SqlAgentDispatchSubmission[] {
		return this.parseOperationalRows(rows, 'queued');
	}

	private parseRunningRows(rows: SqlRow[]): SqlAgentDispatchSubmission[] {
		return this.parseOperationalRows(rows, 'running');
	}

	private parseOperationalRows(
		rows: SqlRow[],
		status: Extract<SqlAgentSubmissionStatus, 'queued' | 'running'>,
	): SqlAgentDispatchSubmission[] {
		const submissions: SqlAgentDispatchSubmission[] = [];
		for (const row of rows) {
			try {
				submissions.push(parseDispatchSubmission(row));
			} catch (error) {
				if (typeof row.sequence !== 'number') throw error;
				this.failDispatchSequence(row.sequence, status, error);
			}
		}
		return submissions;
	}

	private failDispatchSequence(
		sequence: number,
		status: Extract<SqlAgentSubmissionStatus, 'queued' | 'running'>,
		error: unknown,
	): void {
		this.sql.exec(
			`UPDATE flue_agent_submissions
			 SET status = 'error', completed_at = ?, error = ?
			 WHERE sequence = ? AND kind = 'dispatch' AND status = ?`,
			Date.now(),
			error instanceof Error ? error.message : String(error),
			sequence,
			status,
		);
	}

	private readDispatchRow(submissionId: string): SqlRow | undefined {
		return this.sql
			.exec(
				`SELECT sequence, submission_id, session, session_key, kind, payload, status,
				        accepted_at, attempt_id, input_applied_at, recovery_requested_at, started_at, completed_at, error
				 FROM flue_agent_submissions
				 WHERE submission_id = ? AND kind = 'dispatch'
				 LIMIT 1`,
				submissionId,
			)
			.toArray()[0];
	}
}

function parseDispatchSubmission(row: SqlRow): SqlAgentDispatchSubmission {
	if (
		typeof row.sequence !== 'number' ||
		typeof row.submission_id !== 'string' ||
		typeof row.session !== 'string' ||
		typeof row.session_key !== 'string' ||
		row.kind !== 'dispatch' ||
		typeof row.payload !== 'string' ||
		(row.status !== 'queued' &&
			row.status !== 'running' &&
			row.status !== 'completed' &&
			row.status !== 'error') ||
		typeof row.accepted_at !== 'number' ||
		(row.attempt_id !== null && row.attempt_id !== undefined && typeof row.attempt_id !== 'string') ||
		(row.input_applied_at !== null &&
			row.input_applied_at !== undefined &&
			typeof row.input_applied_at !== 'number') ||
		(row.recovery_requested_at !== null &&
			row.recovery_requested_at !== undefined &&
			typeof row.recovery_requested_at !== 'number') ||
		(row.started_at !== null && row.started_at !== undefined && typeof row.started_at !== 'number') ||
		(row.status === 'queued' &&
			(row.attempt_id !== null ||
				row.input_applied_at !== null ||
				row.recovery_requested_at !== null ||
				row.started_at !== null)) ||
		(row.status === 'running' &&
			(typeof row.attempt_id !== 'string' || typeof row.started_at !== 'number'))
	) {
		throw new Error('[flue] Persisted dispatch submission row is malformed.');
	}
	const input = JSON.parse(row.payload) as DispatchInput;
	if (
		!input ||
		typeof input !== 'object' ||
		typeof input.dispatchId !== 'string' ||
		typeof input.agent !== 'string' ||
		typeof input.id !== 'string' ||
		typeof input.session !== 'string' ||
		input.input === undefined ||
		typeof input.acceptedAt !== 'string' ||
		input.dispatchId !== row.submission_id ||
		input.session !== row.session ||
		createSessionStorageKey(input.id, 'default', input.session) !== row.session_key ||
		Date.parse(input.acceptedAt) !== row.accepted_at
	) {
		throw new Error('[flue] Persisted dispatch submission payload is malformed.');
	}
	return {
		sequence: row.sequence,
		submissionId: row.submission_id,
		session: row.session,
		sessionKey: row.session_key,
		input,
		status: row.status,
		acceptedAt: row.accepted_at,
		...(typeof row.attempt_id === 'string' ? { attemptId: row.attempt_id } : {}),
		...(typeof row.input_applied_at === 'number' ? { inputAppliedAt: row.input_applied_at } : {}),
		...(typeof row.recovery_requested_at === 'number'
			? { recoveryRequestedAt: row.recovery_requested_at }
			: {}),
		...(typeof row.started_at === 'number' ? { startedAt: row.started_at } : {}),
		...(typeof row.completed_at === 'number' ? { completedAt: row.completed_at } : {}),
		...(typeof row.error === 'string' ? { error: row.error } : {}),
	};
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
		 recovery_requested_at INTEGER,
		 started_at INTEGER,
		 completed_at INTEGER,
		 error TEXT
		)`,
	);
	ensureSubmissionColumn(sql, 'input_applied_at', 'INTEGER');
	ensureSubmissionColumn(sql, 'recovery_requested_at', 'INTEGER');
	sql.exec(
		'CREATE INDEX IF NOT EXISTS flue_agent_submissions_status_sequence_idx ON flue_agent_submissions (status, sequence ASC)',
	);
	sql.exec(
		'CREATE INDEX IF NOT EXISTS flue_agent_submissions_session_status_sequence_idx ON flue_agent_submissions (session_key, status, sequence ASC)',
	);
}

function ensureSubmissionColumn(sql: SqlStorage, name: string, type: string): void {
	const rows = sql.exec(`SELECT name FROM pragma_table_info('flue_agent_submissions')`).toArray();
	if (!rows.some((row) => row.name === name)) {
		sql.exec(`ALTER TABLE flue_agent_submissions ADD COLUMN ${name} ${type}`);
	}
}
