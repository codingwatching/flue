throw new Error(
	'[@flue/runtime] Importing from "@flue/runtime/client" is no longer supported because that entrypoint was folded into the root runtime package. ' +
		'Write `import { connectMcpServer } from "@flue/runtime"` or `import type { ActionContext } from "@flue/runtime"` instead.',
);

// Preserve the old type surface for one release so TypeScript users get the
// runtime migration error instead of a less helpful "module has no export".
export { Type } from '@earendil-works/pi-ai';
export type { McpServerConnection, McpServerOptions, McpTransport } from './mcp.ts';
export { connectMcpServer } from './mcp.ts';
export type {
	AgentInit,
	BashFactory,
	BashLike,
	FileStat,
	FlueContext,
	FlueEvent,
	FlueEventCallback,
	FlueFs,
	FlueHarness,
	FlueSession,
	FlueSessions,
	ModelConfig,
	PromptModel,
	PromptOptions,
	PromptResponse,
	PromptResultResponse,
	PromptUsage,
	ProviderSettings,
	SandboxFactory,
	SessionData,
	SessionEnv,
	SessionOptions,
	SessionStore,
	ShellOptions,
	ShellResult,
	SkillOptions,
	TaskOptions,
	ThinkingLevel,
	ToolDef,
	ToolParameters,
} from './types.ts';
