import type * as v from 'valibot';
import {
	defineAction,
	isActionDefinition,
	type ActionContext,
	type ActionDefinition,
	type ActionInputSchema,
	type JsonValue,
} from './action.ts';
import { isCreatedAgent } from './agent-definition.ts';
import { isTopLevelObjectSchema, isValibotSchema } from './schema.ts';
import type { CreatedAgent } from './types.ts';

type InlineRunResult<S extends v.GenericSchema | undefined> = S extends v.GenericSchema
	? v.InferInput<S>
	: JsonValue | undefined;

export interface CreatedWorkflow<TAction extends ActionDefinition = ActionDefinition> {
	readonly __flueCreatedWorkflow: true;
	readonly agent: CreatedAgent;
	readonly action: TAction;
}

export type ExtractedWorkflow<TAction extends ActionDefinition = ActionDefinition> =
	CreatedWorkflow<TAction>;

export type InlineWorkflow<
	TInput extends ActionInputSchema | undefined = ActionInputSchema | undefined,
	TOutput extends v.GenericSchema | undefined = v.GenericSchema | undefined,
> = CreatedWorkflow<ActionDefinition<TInput, TOutput>>;

const createdWorkflows = new WeakSet<object>();

type ExtractedWorkflowOptions<TAction extends ActionDefinition> = {
	agent: CreatedAgent;
	action: TAction;
	input?: never;
	output?: never;
	run?: never;
};

type InlineWorkflowOptions<
	TInput extends ActionInputSchema | undefined,
	TOutput extends v.GenericSchema | undefined,
> = {
	agent: CreatedAgent;
	action?: never;
	input?: TInput;
	output?: TOutput;
	run(context: ActionContext<TInput>): InlineRunResult<TOutput> | Promise<InlineRunResult<TOutput>>;
};

export function createWorkflow<TAction extends ActionDefinition>(
	options: ExtractedWorkflowOptions<TAction>,
): ExtractedWorkflow<TAction>;
export function createWorkflow<
	const TInput extends ActionInputSchema | undefined = undefined,
	const TOutput extends v.GenericSchema | undefined = undefined,
>(options: InlineWorkflowOptions<TInput, TOutput>): InlineWorkflow<TInput, TOutput>;
export function createWorkflow(
	options: ExtractedWorkflowOptions<ActionDefinition> | InlineWorkflowOptions<any, any>,
): CreatedWorkflow {
	if (!options || typeof options !== 'object') {
		throw new Error('[flue] createWorkflow() requires a workflow definition object.');
	}
	if (!isCreatedAgent(options.agent)) {
		throw new Error('[flue] createWorkflow({ agent }) requires a CreatedAgent.');
	}
	const hasAction = Object.hasOwn(options, 'action') && options.action !== undefined;
	const hasRun = Object.hasOwn(options, 'run') && options.run !== undefined;
	if (hasAction === hasRun) {
		throw new Error('[flue] createWorkflow() requires exactly one of action or run.');
	}
	if (hasAction) {
		if (!isActionDefinition(options.action)) {
			throw new Error('[flue] createWorkflow({ action }) requires an Action.');
		}
		if (Object.hasOwn(options, 'input') || Object.hasOwn(options, 'output')) {
			throw new Error('[flue] createWorkflow({ action }) does not accept input or output.');
		}
		return createCreatedWorkflow(options.agent, options.action);
	}
	if (typeof options.run !== 'function') {
		throw new Error('[flue] createWorkflow({ run }) must be a function.');
	}
	if (options.input !== undefined) {
		if (!isValibotSchema(options.input) || !isTopLevelObjectSchema(options.input)) {
			throw new Error('[flue] createWorkflow({ input }) must be a top-level object Valibot schema.');
		}
	}
	if (options.output !== undefined && !isValibotSchema(options.output)) {
		throw new Error('[flue] createWorkflow({ output }) must be a Valibot schema.');
	}
	const action = defineAction({
		name: 'workflow',
		description: 'Workflow-private action.',
		input: options.input,
		output: options.output,
		run: options.run,
	} as never);
	return createCreatedWorkflow(options.agent, action);
}

function createCreatedWorkflow<TAction extends ActionDefinition>(
	agent: CreatedAgent,
	action: TAction,
): CreatedWorkflow<TAction> {
	const workflow = Object.freeze({
		__flueCreatedWorkflow: true as const,
		agent,
		action,
	});
	createdWorkflows.add(workflow);
	return workflow;
}

export function isCreatedWorkflow(value: unknown): value is CreatedWorkflow {
	return Boolean(value && typeof value === 'object' && createdWorkflows.has(value));
}

