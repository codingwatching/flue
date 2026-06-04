import type {
	AgentSubmissionInput,
	DirectSubmissionInput,
	DispatchInput,
} from '../runtime/dispatch-queue.ts';
import { isDispatchSubmissionInput } from '../runtime/dispatch-queue.ts';
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

export interface SqlAgentSubmission {
	readonly sequence: number;
	readonly submissionId: string;
	readonly session: string;
	readonly sessionKey: string;
	readonly kind: 'dispatch' | 'direct';
	readonly input: AgentSubmissionInput;
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
	getSubmission(submissionId: string): SqlAgentSubmission | null;
	admitDispatch(input: DispatchInput): SqlAgentSubmission;
	admitDirect(input: DirectSubmissionInput): SqlAgentSubmission;
	adoptLegacyDispatches(inputs: readonly DispatchInput[]): SqlAgentSubmission[];
	hasUnsettledSubmissions(): boolean;
	listQueuedSubmissions(): SqlAgentSubmission[];
	listRunnableSubmissions(): SqlAgentSubmission[];
	listRunningSubmissions(): SqlAgentSubmission[];
	claimSubmission(submissionId: string, attemptId: string): SqlAgentSubmission | null;
	markSubmissionInputApplied(submissionId: string, attemptId: string): SqlAgentSubmission | null;
	requestSubmissionRecovery(submissionId: string, attemptId: string): SqlAgentSubmission | null;
	requeueSubmissionBeforeInputApplied(
		submissionId: string,
		attemptId: string,
	): SqlAgentSubmission | null;
	completeSubmission(submissionId: string, attemptId: string): boolean;
	failSubmission(submissionId: string, attemptId: string, error: unknown): boolean;
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

	getSubmission(submissionId: string): SqlAgentSubmission | null {
		const row = this.readSubmissionRow(submissionId);
		return row ? parseSubmission(row) : null;
	}

	admitDispatch(input: DispatchInput): SqlAgentSubmission {
		return this.admitSubmission('dispatch', input.dispatchId, input);
	}

	admitDirect(input: DirectSubmissionInput): SqlAgentSubmission {
		return this.admitSubmission('direct', input.submissionId, input);
	}

	adoptLegacyDispatches(inputs: readonly DispatchInput[]): SqlAgentSubmission[] {
		const unique = new Map<string, DispatchInput>();
		for (const input of inputs) {
			const payload = JSON.stringify(input);
			const row = this.readSubmissionRow(input.dispatchId);
			if (row && (row.kind !== 'dispatch' || row.payload !== payload)) {
				throw new SqlAgentSubmissionConflictError('[flue] Conflicting legacy dispatch adoption.');
			}
			const prior = unique.get(input.dispatchId);
			if (prior && JSON.stringify(prior) !== payload) {
				throw new SqlAgentSubmissionConflictError('[flue] Conflicting legacy dispatch adoption.');
			}
			if (!prior) unique.set(input.dispatchId, input);
		}
		const missing = [...unique.values()].filter((input) => !this.readSubmissionRow(input.dispatchId));
		const adopt = () => {
			const first = this.sql
				.exec('SELECT MIN(sequence) AS sequence FROM flue_agent_submissions')
				.toArray()[0]?.sequence;
			let sequence = typeof first === 'number' ? first - missing.length : -missing.length;
			for (let offset = 0; offset < missing.length; offset += 16) {
				const batch = missing.slice(offset, offset + 16);
				const values: unknown[] = [];
				for (const input of batch) {
					const acceptedAt = parseAcceptedAt(input.acceptedAt, 'Legacy dispatch adoption');
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
			const submission = this.getSubmission(input.dispatchId);
			if (!submission || submission.kind !== 'dispatch') {
				throw new Error('[flue] Legacy dispatch adoption did not create a submission row.');
			}
			return submission;
		});
	}

	hasUnsettledSubmissions(): boolean {
		return (
			this.sql
				.exec(
					`SELECT 1
					 FROM flue_agent_submissions
					 WHERE status IN ('queued', 'running')
					 LIMIT 1`,
				)
				.toArray().length > 0
		);
	}

	listQueuedSubmissions(): SqlAgentSubmission[] {
		return this.parseOperationalRows(
			this.sql
				.exec(
					`SELECT ${submissionColumns}
					 FROM flue_agent_submissions
					 WHERE status = 'queued'
					 ORDER BY sequence ASC`,
				)
				.toArray(),
			'queued',
		);
	}

	listRunnableSubmissions(): SqlAgentSubmission[] {
		const rows = this.sql
			.exec(
				`SELECT ${submissionColumnsFor('current')}
				 FROM flue_agent_submissions AS current
				 WHERE current.status = 'queued'
				   AND NOT EXISTS (
				     SELECT 1
				     FROM flue_agent_submissions AS earlier
				     WHERE earlier.session_key = current.session_key
				       AND earlier.status IN ('queued', 'running')
				       AND earlier.sequence < current.sequence
				   )
				 ORDER BY current.sequence ASC`,
			)
			.toArray();
		return this.parseOperationalRows(rows, 'queued');
	}

	listRunningSubmissions(): SqlAgentSubmission[] {
		return this.parseOperationalRows(
			this.sql
				.exec(
					`SELECT ${submissionColumns}
					 FROM flue_agent_submissions
					 WHERE status = 'running'
					 ORDER BY sequence ASC`,
				)
				.toArray(),
			'running',
		);
	}

	claimSubmission(submissionId: string, attemptId: string): SqlAgentSubmission | null {
		this.sql.exec(
			`UPDATE flue_agent_submissions AS current
			 SET status = 'running', attempt_id = ?, started_at = ?
			 WHERE current.submission_id = ? AND current.status = 'queued'
			   AND NOT EXISTS (
			     SELECT 1
			     FROM flue_agent_submissions AS earlier
			     WHERE earlier.session_key = current.session_key
			       AND earlier.status IN ('queued', 'running')
			       AND earlier.sequence < current.sequence
			   )`,
			attemptId,
			Date.now(),
			submissionId,
		);
		const submission = this.getSubmission(submissionId);
		return submission?.status === 'running' && submission.attemptId === attemptId
			? submission
			: null;
	}

	markSubmissionInputApplied(submissionId: string, attemptId: string): SqlAgentSubmission | null {
		this.sql.exec(
			`UPDATE flue_agent_submissions
			 SET input_applied_at = COALESCE(input_applied_at, ?)
			 WHERE submission_id = ? AND status = 'running' AND attempt_id = ?`,
			Date.now(),
			submissionId,
			attemptId,
		);
		return this.getOwnedRunningSubmission(submissionId, attemptId);
	}

	requestSubmissionRecovery(submissionId: string, attemptId: string): SqlAgentSubmission | null {
		this.sql.exec(
			`UPDATE flue_agent_submissions
			 SET recovery_requested_at = COALESCE(recovery_requested_at, ?)
			 WHERE submission_id = ? AND status = 'running' AND attempt_id = ?`,
			Date.now(),
			submissionId,
			attemptId,
		);
		return this.getOwnedRunningSubmission(submissionId, attemptId);
	}

	requeueSubmissionBeforeInputApplied(
		submissionId: string,
		attemptId: string,
	): SqlAgentSubmission | null {
		this.sql.exec(
			`UPDATE flue_agent_submissions
			 SET status = 'queued', attempt_id = NULL, recovery_requested_at = NULL, started_at = NULL
			 WHERE submission_id = ? AND status = 'running'
			   AND attempt_id = ? AND input_applied_at IS NULL`,
			submissionId,
			attemptId,
		);
		const submission = this.getSubmission(submissionId);
		return submission?.status === 'queued' ? submission : null;
	}

	completeSubmission(submissionId: string, attemptId: string): boolean {
		this.sql.exec(
			`UPDATE flue_agent_submissions
			 SET status = 'completed', completed_at = ?, error = NULL
			 WHERE submission_id = ? AND status = 'running' AND attempt_id = ?`,
			Date.now(),
			submissionId,
			attemptId,
		);
		const submission = this.getSubmission(submissionId);
		return submission?.status === 'completed' && submission.attemptId === attemptId;
	}

	failSubmission(submissionId: string, attemptId: string, error: unknown): boolean {
		this.sql.exec(
			`UPDATE flue_agent_submissions
			 SET status = 'error', completed_at = ?, error = ?
			 WHERE submission_id = ? AND status = 'running' AND attempt_id = ?`,
			Date.now(),
			error instanceof Error ? error.message : String(error),
			submissionId,
			attemptId,
		);
		const submission = this.getSubmission(submissionId);
		return submission?.status === 'error' && submission.attemptId === attemptId;
	}

	private admitSubmission(
		kind: SqlAgentSubmission['kind'],
		submissionId: string,
		input: AgentSubmissionInput,
	): SqlAgentSubmission {
		const payload = JSON.stringify(input);
		const acceptedAt = parseAcceptedAt(input.acceptedAt, `${kind} admission`);
		this.sql.exec(
			`INSERT OR IGNORE INTO flue_agent_submissions
			 (submission_id, session, session_key, kind, payload, status, accepted_at)
			 VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
			submissionId,
			input.session,
			createSessionStorageKey(input.id, 'default', input.session),
			kind,
			payload,
			acceptedAt,
		);
		const row = this.readSubmissionRow(submissionId);
		if (!row) throw new Error(`[flue] Durable ${kind} admission did not create a submission row.`);
		if (row.kind !== kind || row.payload !== payload) {
			throw new SqlAgentSubmissionConflictError(`[flue] Conflicting internal ${kind} replay.`);
		}
		return parseSubmission(row);
	}

	private getOwnedRunningSubmission(
		submissionId: string,
		attemptId: string,
	): SqlAgentSubmission | null {
		const submission = this.getSubmission(submissionId);
		return submission?.status === 'running' && submission.attemptId === attemptId
			? submission
			: null;
	}

	private parseOperationalRows(
		rows: SqlRow[],
		status: Extract<SqlAgentSubmissionStatus, 'queued' | 'running'>,
	): SqlAgentSubmission[] {
		const submissions: SqlAgentSubmission[] = [];
		for (const row of rows) {
			try {
				submissions.push(parseSubmission(row));
			} catch (error) {
				if (typeof row.sequence !== 'number') throw error;
				this.failSubmissionSequence(row.sequence, status, error);
			}
		}
		return submissions;
	}

	private failSubmissionSequence(
		sequence: number,
		status: Extract<SqlAgentSubmissionStatus, 'queued' | 'running'>,
		error: unknown,
	): void {
		this.sql.exec(
			`UPDATE flue_agent_submissions
			 SET status = 'error', completed_at = ?, error = ?
			 WHERE sequence = ? AND status = ?`,
			Date.now(),
			error instanceof Error ? error.message : String(error),
			sequence,
			status,
		);
	}

	private readSubmissionRow(submissionId: string): SqlRow | undefined {
		return this.sql
			.exec(
				`SELECT ${submissionColumns}
				 FROM flue_agent_submissions
				 WHERE submission_id = ?
				 LIMIT 1`,
				submissionId,
			)
			.toArray()[0];
	}
}

const submissionColumns =
	'sequence, submission_id, session, session_key, kind, payload, status, accepted_at, attempt_id, input_applied_at, recovery_requested_at, started_at, completed_at, error';

function submissionColumnsFor(table: string): string {
	return submissionColumns
		.split(', ')
		.map((column) => `${table}.${column}`)
		.join(', ');
}

function parseSubmission(row: SqlRow): SqlAgentSubmission {
	if (
		typeof row.sequence !== 'number' ||
		typeof row.submission_id !== 'string' ||
		typeof row.session !== 'string' ||
		typeof row.session_key !== 'string' ||
		(row.kind !== 'dispatch' && row.kind !== 'direct') ||
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
		throw new Error('[flue] Persisted agent submission row is malformed.');
	}
	const input = JSON.parse(row.payload) as unknown;
	if (!isSubmissionPayload(input, row)) {
		throw new Error('[flue] Persisted agent submission payload is malformed.');
	}
	return {
		sequence: row.sequence,
		submissionId: row.submission_id,
		session: row.session,
		sessionKey: row.session_key,
		kind: row.kind,
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

function isSubmissionPayload(input: unknown, row: SqlRow): input is AgentSubmissionInput {
	if (!input || typeof input !== 'object') return false;
	const value = input as Partial<AgentSubmissionInput>;
	if (
		typeof value.agent !== 'string' ||
		typeof value.id !== 'string' ||
		typeof value.session !== 'string' ||
		typeof value.acceptedAt !== 'string' ||
		value.session !== row.session ||
		createSessionStorageKey(value.id, 'default', value.session) !== row.session_key ||
		Date.parse(value.acceptedAt) !== row.accepted_at
	) {
		return false;
	}
	if (row.kind === 'dispatch') {
		return (
		'dispatchId' in value &&
		typeof value.dispatchId === 'string' &&
		value.dispatchId === row.submission_id &&
		'input' in value &&
		value.input !== undefined
		);
	}
	return (
		'submissionId' in value &&
		typeof value.submissionId === 'string' &&
		value.submissionId === row.submission_id &&
		'payload' in value &&
		isDirectPayload(value.payload) &&
		!isDispatchSubmissionInput(value as AgentSubmissionInput)
	);
}

function isDirectPayload(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const payload = value as { message?: unknown; session?: unknown };
	return (
		typeof payload.message === 'string' &&
		(payload.session === undefined || typeof payload.session === 'string')
	);
}

function parseAcceptedAt(value: string, label: string): number {
	const acceptedAt = Date.parse(value);
	if (!Number.isFinite(acceptedAt)) {
		throw new Error(`[flue] Internal ${label} received an invalid acceptedAt timestamp.`);
	}
	return acceptedAt;
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
