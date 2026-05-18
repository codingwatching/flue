---
{
  "category": "sandbox",
  "website": "https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/"
}
---

# Add a Flue Connector: Cloudflare Shell

You are an AI coding agent installing the Cloudflare Shell sandbox connector
for a Flue Cloudflare-target project. Follow these instructions exactly.
Confirm with the user only when something is genuinely ambiguous.

## What this connector does

Wraps an already-initialized `@cloudflare/shell` `Workspace` into Flue's
`SandboxFactory` interface. The connector exposes a codemode-backed `code`
tool that runs JavaScript against the durable workspace through a Worker Loader
binding. The user owns workspace construction and hydration.

## Where to write the file

Pick the location based on the user's source layout:

- **If `<root>/.flue/` exists**, write to `./.flue/connectors/cloudflare-shell.ts`.
- **Otherwise**, write to `./connectors/cloudflare-shell.ts` at the project root.

If neither feels right, ask the user before writing. Create any missing parent
directories.

## File contents

Write this file verbatim. It requires a Cloudflare Worker target with a
`worker_loaders` binding.

```ts
import {
	STATE_TYPES,
	Workspace,
	WorkspaceFileSystem,
	type FsStat as CfFsStat,
} from '@cloudflare/shell';
import { stateTools } from '@cloudflare/shell/workers';
import {
	DynamicWorkerExecutor,
	resolveProvider,
	type DynamicWorkerExecutorOptions,
	type ResolvedProvider,
} from '@cloudflare/codemode';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { type Static, Type } from '@earendil-works/pi-ai';
import { getCloudflareContext } from '@flue/runtime/cloudflare';
import type {
	FileStat,
	SandboxFactory,
	SessionEnv,
	SessionToolFactory,
	ShellResult,
} from '@flue/runtime';

export interface GetShellSandboxOptions {
	workspace: Workspace;
	loader: WorkerLoader;
	executor?: Pick<DynamicWorkerExecutorOptions, 'timeout' | 'globalOutbound' | 'modules'>;
}

export interface HydrateFromBucketOptions {
	prefix?: string;
}

export async function hydrateFromBucket(
	workspace: Workspace,
	bucket: R2Bucket,
	options?: HydrateFromBucketOptions,
): Promise<void> {
	const prefix = options?.prefix;
	let cursor: string | undefined;

	while (true) {
		const listing = await bucket.list({ prefix, cursor });
		for (const obj of listing.objects) {
			const relativeKey = stripPrefix(obj.key, prefix);
			if (relativeKey === '' || relativeKey.endsWith('/')) continue;
			const body = await bucket.get(obj.key);
			if (!body) continue;
			await workspace.writeFileBytes(
				absolutize(relativeKey),
				new Uint8Array(await body.arrayBuffer()),
			);
		}

		if (!listing.truncated) break;
		if (!listing.cursor) {
			throw new Error('[flue] R2 listing was truncated but did not include a cursor.');
		}
		cursor = listing.cursor;
	}
}

function stripPrefix(key: string, prefix: string | undefined): string {
	if (!prefix) return key;
	return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

function absolutize(key: string): string {
	return key.startsWith('/') ? key : '/' + key;
}

export function getShellSandbox(options: GetShellSandboxOptions): SandboxFactory {
	if (!options || !options.workspace) {
		throw new Error(
			'[flue] getShellSandbox requires a workspace. Pass `getDefaultWorkspace()` for the common case, ' +
				'or construct your own with `new Workspace({ sql: ctx.storage.sql, ... })`.',
		);
	}
	if (!options.loader) {
		throw new Error(
			'[flue] getShellSandbox requires a WorkerLoader binding. Add this to your wrangler.jsonc:\n' +
				'  { "worker_loaders": [{ "binding": "LOADER" }] }\n' +
				'Then pass `loader: env.LOADER` to getShellSandbox(). Worker Loader is currently in beta — ' +
				'see https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/.',
		);
	}

	const { workspace, loader, executor: executorOptions } = options;
	const fs = new WorkspaceFileSystem(workspace);
	const executor = new DynamicWorkerExecutor({
		loader,
		...executorOptions,
	});
	const stateProvider = resolveProvider(stateTools(workspace));
	const toolFactory: SessionToolFactory = () => [createCodeTool(executor, stateProvider)];

	return {
		async createSessionEnv() {
			return createWorkspaceSessionEnv(workspace, fs, '/');
		},
		tools: toolFactory,
	};
}

function normalizePath(p: string): string {
	const parts = p.split('/');
	const result: string[] = [];
	for (const part of parts) {
		if (part === '.' || part === '') continue;
		if (part === '..') result.pop();
		else result.push(part);
	}
	return '/' + result.join('/');
}

function createWorkspaceSessionEnv(
	workspace: Workspace,
	fs: WorkspaceFileSystem,
	cwd: string,
): SessionEnv {
	const normalizedCwd = normalizePath(cwd);
	const resolvePath = (p: string): string => {
		if (p.startsWith('/')) return normalizePath(p);
		if (normalizedCwd === '/') return normalizePath('/' + p);
		return normalizePath(normalizedCwd + '/' + p);
	};
	const exec = (): Promise<ShellResult> => {
		throw new Error(EXEC_NOT_SUPPORTED_MESSAGE);
	};

	return {
		exec,
		async readFile(path: string): Promise<string> {
			return fs.readFile(resolvePath(path));
		},
		async readFileBuffer(path: string): Promise<Uint8Array> {
			return fs.readFileBytes(resolvePath(path));
		},
		async writeFile(path: string, content: string | Uint8Array): Promise<void> {
			const resolved = resolvePath(path);
			if (typeof content === 'string') await workspace.writeFile(resolved, content);
			else await workspace.writeFileBytes(resolved, content);
		},
		async stat(path: string): Promise<FileStat> {
			return adaptStat(await fs.stat(resolvePath(path)));
		},
		async readdir(path: string): Promise<string[]> {
			return fs.readdir(resolvePath(path));
		},
		async exists(path: string): Promise<boolean> {
			return fs.exists(resolvePath(path));
		},
		async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
			await fs.mkdir(resolvePath(path), opts);
		},
		async rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
			await fs.rm(resolvePath(path), opts);
		},
		cwd: normalizedCwd,
		resolvePath,
	};
}

const EXEC_NOT_SUPPORTED_MESSAGE =
	'[flue] The cf-shell sandbox does not support exec(). The agent\'s `code` tool runs JavaScript ' +
	'in an isolated Worker against the workspace; from your own code, use `session.fs` / `harness.fs` ' +
	'(readFile, writeFile, stat, readdir, etc.) — they route through the same Workspace. If you ' +
	'specifically need bash/grep/find or a real Linux environment, use `@cloudflare/sandbox` ' +
	'(Containers + mountBucket) instead.';

function adaptStat(s: CfFsStat): FileStat {
	return {
		isFile: s.type === 'file',
		isDirectory: s.type === 'directory',
		isSymbolicLink: s.type === 'symlink',
		size: s.size,
		mtime: s.mtime,
	};
}

const CodeParams = Type.Object({
	code: Type.String({
		description:
			'A single async arrow function with the signature `async () => { ... return result; }`. ' +
			'Inside the body, call `state.*` to operate on the workspace (see the type declarations ' +
			'below). The function executes in an isolated Worker — no network, no DOM, no imports. ' +
			'Return whatever JSON-serializable value you want back; it is returned as the tool result.',
	}),
});

function createCodeTool(
	executor: DynamicWorkerExecutor,
	stateProvider: ResolvedProvider,
): AgentTool<typeof CodeParams> {
	return {
		name: 'code',
		label: 'Run Code',
		description: buildCodeToolDescription(),
		parameters: CodeParams,
		async execute(
			_toolCallId: string,
			params: Static<typeof CodeParams>,
		): Promise<AgentToolResult<{ logs?: string[]; error?: string }>> {
			const { result, error, logs } = await executor.execute(params.code, [stateProvider]);
			if (error) {
				const logsTail = logs && logs.length ? `\n\nlogs:\n${logs.join('\n')}` : '';
				throw new Error(`code tool failed: ${error}${logsTail}`);
			}
			const resultText = formatResult(result);
			const logsText = logs && logs.length ? `\n\n--- logs ---\n${logs.join('\n')}` : '';
			return {
				content: [{ type: 'text', text: resultText + logsText }],
				details: logs && logs.length ? { logs } : {},
			};
		},
	};
}

function formatResult(result: unknown): string {
	if (result === undefined) return '(no result)';
	if (typeof result === 'string') return result;
	try {
		return JSON.stringify(result, null, 2);
	} catch {
		return String(result);
	}
}

function buildCodeToolDescription(): string {
	return [
		'Run a snippet of JavaScript inside an isolated Worker against a durable',
		'workspace filesystem. The snippet must be a single async arrow function:',
		'',
		'  async () => {',
		'    const text = await state.readFile("/notes.md");',
		'    await state.writeFile("/notes.md", text.toUpperCase());',
		'    return { bytes: text.length };',
		'  }',
		'',
		'Rules:',
		'- Write JavaScript, not TypeScript — no type annotations.',
		'- Do not use `import` statements. Everything you need is on `state`.',
		'- Always `return` the value you want back.',
		'- For multi-file refactors, prefer `state.planEdits()` + `state.applyEditPlan()` over many writes.',
		'- For tree-wide search/replace, use `state.replaceInFiles()` (transactional by default).',
		'- Network access (`fetch`, `connect`) is disabled. Do not attempt outbound HTTP.',
		'',
		'The `state` API (TypeScript declaration; the runtime is JavaScript):',
		'',
		'```typescript',
		STATE_TYPES,
		'```',
	].join('\n');
}

export function getDefaultWorkspace(): Workspace {
	const { storage } = getCloudflareContext();
	return new Workspace({ sql: storage.sql });
}
```

## Required dependencies

This connector imports Cloudflare Shell, codemode, and the Pi tool types used
by Flue's tool surface. If the user's `package.json` does not already list
them, add them with the user's package manager:

```bash
npm install @cloudflare/shell @cloudflare/codemode @earendil-works/pi-agent-core @earendil-works/pi-ai
```

## Authentication

No provider API key is required. The project must run on Cloudflare Workers and
must configure a Worker Loader binding. Add this to `wrangler.jsonc` if it is
not already present:

```jsonc
{
  "worker_loaders": [{ "binding": "LOADER" }]
}
```

Worker Loader is currently beta-gated. Never invent Cloudflare account details
or tokens; the user authenticates through their existing Wrangler setup.

## Wiring it into an agent

```ts
import type { ActionContext } from '@flue/runtime';
import { getDefaultWorkspace, getShellSandbox } from '../connectors/cloudflare-shell';

export const triggers = { webhook: true };

interface Env {
  LOADER: WorkerLoader;
}

export default async function ({ init, env }: ActionContext<unknown, Env>) {
  const workspace = getDefaultWorkspace();
  const harness = await init({
    sandbox: getShellSandbox({ workspace, loader: env.LOADER }),
    model: 'cloudflare/@cf/moonshotai/kimi-k2.6',
  });
  const session = await harness.session();
  return await session.prompt('Use the code tool to list the workspace root.');
}
```

## Optional R2 hydration

If the user wants bucket contents copied into the Workspace before the agent
runs, use the `hydrateFromBucket()` helper that this connector file exports:

```ts
import type { ActionContext } from '@flue/runtime';
import {
  getDefaultWorkspace,
  getShellSandbox,
  hydrateFromBucket,
} from '../connectors/cloudflare-shell';

export const triggers = { webhook: true };

interface Env {
  KNOWLEDGE_BASE: R2Bucket;
  LOADER: WorkerLoader;
}

export default async function ({ init, env }: ActionContext<unknown, Env>) {
  const workspace = getDefaultWorkspace();
  if (!(await workspace.exists('/.hydrated'))) {
    await hydrateFromBucket(workspace, env.KNOWLEDGE_BASE);
    await workspace.writeFile('/.hydrated', new Date().toISOString());
  }
  const harness = await init({
    sandbox: getShellSandbox({ workspace, loader: env.LOADER }),
    model: 'cloudflare/@cf/moonshotai/kimi-k2.6',
  });
  const session = await harness.session();
  return await session.prompt('Use the code tool to inspect the hydrated workspace.');
}
```

## Verify

1. Run the user's typechecker.
2. Confirm the import path matches where you wrote `cloudflare-shell.ts`.
3. Confirm `wrangler.jsonc` has a `worker_loaders` binding matching the code.
4. Tell the user to use `flue dev --target cloudflare`; if local Wrangler cannot simulate Worker Loader, use remote dev or deploy a preview Worker.
