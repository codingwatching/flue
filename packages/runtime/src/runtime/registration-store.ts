export interface RegistrationKey {
	agentName: string;
	instanceId: string;
}

export interface RegistrationClaim {
	complete(): Promise<void>;
	release(): Promise<void>;
}

export interface RegistrationStore {
	claim(key: RegistrationKey): Promise<RegistrationClaim | null>;
}
