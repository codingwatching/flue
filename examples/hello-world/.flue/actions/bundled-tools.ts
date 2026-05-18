import { Type, defineAgent, defineTool, type ActionContext } from '@flue/runtime';

export const triggers = { webhook: true };

const uppercase = defineTool({
	name: 'uppercase',
	description: 'Convert text to uppercase.',
	parameters: Type.Object({ text: Type.String() }),
	execute: async (args) => String(args.text).toUpperCase(),
});

const toolAgent = defineAgent({
	name: 'bundled-tools',
	model: 'anthropic/claude-sonnet-4-6',
	tools: [uppercase],
});

export default async function ({ init, payload }: ActionContext) {
	const harness = await init({ agent: toolAgent });
	const session = await harness.session();
	return await session.prompt(`Use the uppercase tool on: ${payload.text ?? 'hello from Flue'}`);
}
