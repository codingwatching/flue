import type { ToolDefinition, ToolParameters } from './types.ts';

/**
 * Define a typed tool value for an agent or a single prompt/skill/task call.
 *
 * @example
 * const lookup = defineTool({ name: 'lookup', description: 'Find a record.', parameters, execute });
 * const agent = defineAgent({ name: 'assistant', tools: [lookup] });
 */
export function defineTool<TParams extends ToolParameters>(
	tool: ToolDefinition<TParams>,
): ToolDefinition<TParams> {
	if (!tool || typeof tool !== 'object') {
		throw new Error('[flue] defineTool() requires a tool definition object.');
	}
	if (typeof tool.name !== 'string' || tool.name.trim().length === 0) {
		throw new Error('[flue] defineTool({ name }) must be a non-empty string.');
	}
	if (typeof tool.description !== 'string' || tool.description.trim().length === 0) {
		throw new Error('[flue] defineTool({ description }) must be a non-empty string.');
	}
	if (!tool.parameters || typeof tool.parameters !== 'object') {
		throw new Error('[flue] defineTool({ parameters }) is required.');
	}
	if (typeof tool.execute !== 'function') {
		throw new Error('[flue] defineTool({ execute }) must be a function.');
	}
	return Object.freeze({ ...tool });
}
