throw new Error(
	'[@flue/runtime] Importing from "@flue/runtime/sandbox" is no longer supported because that entrypoint was folded into the root runtime package. ' +
		'Write `import type { SandboxFactory, SessionEnv } from "@flue/runtime"` instead.',
);

// Preserve the old type surface for one release so TypeScript users get the
// runtime migration error instead of a less helpful "module has no export".
export type { SandboxFactory, SessionEnv, FileStat } from './types.ts';
export { createSandboxSessionEnv, type SandboxApi } from './sandbox.ts';
