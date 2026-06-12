import {
	createAgent,
	defineTool,
	type FlueContext,
	type WorkflowRouteHandler,
} from '@flue/runtime';
import * as v from 'valibot';

export const route: WorkflowRouteHandler = async (_c, next) => next();

const agent = createAgent(() => ({ model: 'anthropic/claude-haiku-4-5' }));

const lookup = defineTool({
	name: 'lookup_weather',
	description: 'Look up current weather for a city.',
	parameters: v.object({ city: v.string() }),
	execute: async ({ city }) => `${city}: sunny, 72 F`,
});

export async function run({ init, payload }: FlueContext) {
	const harness = await init(agent);
	const session = await harness.session();
	const city = typeof payload.city === 'string' ? payload.city : 'San Francisco';
	const response = await session.prompt(
		`Use the weather tool to report current weather in ${city}.`,
		{ tools: [lookup] },
	);
	return { message: response.text };
}
