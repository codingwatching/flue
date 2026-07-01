// flue-blueprint: tooling/vitest-evals@1
import { createFlueClient, type FlueConversationMessage } from '@flue/sdk';
import { createHarness, type SimpleToolCallRecord } from 'vitest-evals';

export interface FlueAgentHarnessOptions {
	agentName: string;
	baseUrl?: string;
	token?: string;
	headers?: Record<string, string>;
}

function lastAssistantText(messages: FlueConversationMessage[]): string {
	const message = messages.findLast((entry) => entry.role === 'assistant');
	if (!message) return '';
	return message.parts
		.filter((part) => part.type === 'text')
		.map((part) => part.text)
		.join('');
}

function collectToolCalls(messages: FlueConversationMessage[]): SimpleToolCallRecord[] {
	return messages.flatMap((message) =>
		message.parts.flatMap((part) => {
			if (part.type !== 'dynamic-tool') return [];
			return [
				{
					id: part.toolCallId,
					name: part.toolName,
					arguments: part.input,
					...(part.state === 'output-error'
						? { error: part.errorText }
						: part.state === 'output-available'
							? { result: part.output }
							: {}),
				},
			];
		}),
	);
}

export function createFlueAgentHarness(options: FlueAgentHarnessOptions) {
	const client = createFlueClient({
		baseUrl: options.baseUrl ?? process.env.FLUE_BASE_URL ?? 'http://127.0.0.1:3583',
		token: options.token,
		headers: options.headers,
	});

	return createHarness<string, string>({
		name: `flue-${options.agentName}-agent`,
		run: async ({ input, signal }) => {
			const instanceId = `eval-${crypto.randomUUID()}`;
			const admission = await client.agents.send(options.agentName, instanceId, {
				message: input,
				signal,
			});
			await client.agents.wait(admission, { signal });
			const history = await client.agents.history(options.agentName, instanceId, { signal });

			return {
				output: lastAssistantText(history.messages),
				toolCalls: collectToolCalls(history.messages),
			};
		},
	});
}
