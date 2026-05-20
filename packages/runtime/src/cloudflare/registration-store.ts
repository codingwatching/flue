import type {
	RegistrationClaim,
	RegistrationKey,
	RegistrationStore,
} from '../runtime/registration-store.ts';

interface SqlResult {
	toArray(): SqlRow[];
}

type SqlRow = Record<string, unknown>;

export interface SqlStorage {
	exec(query: string, ...bindings: unknown[]): SqlResult;
}

export function createDurableRegistrationStore(sql: SqlStorage): RegistrationStore {
	ensureRegistrationTable(sql);
	return new DurableRegistrationStore(sql);
}

class DurableRegistrationStore implements RegistrationStore {
	constructor(private sql: SqlStorage) {}

	async claim(registration: RegistrationKey): Promise<RegistrationClaim | null> {
		const inserted = this.sql
			.exec(
				`INSERT OR IGNORE INTO flue_registration_slots
				 (agent_name, instance_id, status, updated_at)
				 VALUES (?, ?, ?, ?) RETURNING instance_id`,
				registration.agentName,
				registration.instanceId,
				'active',
				Date.now(),
			)
			.toArray();
		if (inserted.length === 0) return null;
		return {
			complete: async () => {
				this.sql.exec(
					`UPDATE flue_registration_slots
					 SET status = ?, updated_at = ?
					 WHERE agent_name = ? AND instance_id = ?`,
					'completed',
					Date.now(),
					registration.agentName,
					registration.instanceId,
				);
			},
			release: async () => {
				this.sql.exec(
					`DELETE FROM flue_registration_slots
					 WHERE agent_name = ? AND instance_id = ? AND status = ?`,
					registration.agentName,
					registration.instanceId,
					'active',
				);
			},
		};
	}
}

function ensureRegistrationTable(sql: SqlStorage): void {
	sql.exec(
		`CREATE TABLE IF NOT EXISTS flue_registration_slots (
		 agent_name TEXT NOT NULL,
		 instance_id TEXT NOT NULL,
		 status TEXT NOT NULL,
		 updated_at INTEGER NOT NULL,
		 PRIMARY KEY (agent_name, instance_id)
		)`,
	);
}
