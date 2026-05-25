import { createAgent, http, type FlueContext } from '@flue/runtime';
import review from '../skills/review/SKILL.md' with { type: 'skill' };

export const channels = [http()];

const agent = createAgent(() => ({ model: 'anthropic/claude-haiku-4-5', skills: [review] }));

export async function run({ init }: FlueContext) {
	const harness = await init(agent);
	const session = await harness.session();
	const response = await session.skill(review);
	return { text: response.text, reference: review };
}
