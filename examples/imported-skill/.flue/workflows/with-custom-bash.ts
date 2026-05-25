import { createAgent, http, type FlueContext } from '@flue/runtime';
import { Bash, InMemoryFs } from 'just-bash';

export const channels = [http()];

export async function run({ init }: FlueContext) {
	const fs = new InMemoryFs();
	const agent = createAgent(() => ({ sandbox: () => new Bash({ fs }), model: false }));
	const harness = await init(agent);
	const session = await harness.session();
	await session.shell('echo "custom bash succeeded" > proof.txt');
	const result = await session.shell('cat proof.txt');
	return { text: result.stdout.trim() };
}
