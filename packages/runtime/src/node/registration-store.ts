import type {
	RegistrationClaim,
	RegistrationKey,
	RegistrationStore,
} from '../runtime/registration-store.ts';

export class InMemoryRegistrationStore implements RegistrationStore {
	private completed = new Set<string>();
	private active = new Set<string>();

	async claim(registration: RegistrationKey): Promise<RegistrationClaim | null> {
		const key = createRegistrationKey(registration);
		if (this.completed.has(key) || this.active.has(key)) return null;
		this.active.add(key);
		return {
			complete: async () => {
				this.active.delete(key);
				this.completed.add(key);
			},
			release: async () => {
				this.active.delete(key);
			},
		};
	}
}

function createRegistrationKey(registration: RegistrationKey): string {
	return JSON.stringify([registration.agentName, registration.instanceId]);
}
