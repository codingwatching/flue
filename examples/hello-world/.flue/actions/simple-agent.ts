import { defineAgent, type ActionContext } from '@flue/runtime';

export const triggers = { webhook: true };

const conciseAgent = defineAgent({
	name: 'simple-agent',
	model: 'anthropic/claude-sonnet-4-6',
	instructions: 'Answer in one concise sentence.',
});

export default async function ({ init, payload }: ActionContext) {
	const harness = await init({ agent: conciseAgent });
	const session = await harness.session();
	return await session.prompt(payload.prompt ?? 'Explain what Flue does.');
}
