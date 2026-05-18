---
{
  "category": "sandbox",
  "website": "https://nodejs.org"
}
---

# Add a Flue Connector: Local

You are an AI coding agent installing the local host sandbox connector for a
Flue project. Follow these instructions exactly. Confirm with the user only
when something is genuinely ambiguous.

## What this connector does

Wraps the Node.js host filesystem and shell into Flue's `SandboxFactory`
interface. Commands run with `node:child_process`, files are read and written
through `node:fs/promises`, and env exposure stays opt-in outside a small
shell-essential allowlist.

## Where to write the file

Pick the location based on the user's source layout:

- **If `<root>/.flue/` exists**, write to `./.flue/connectors/local.ts`.
- **Otherwise**, write to `./connectors/local.ts` at the project root.

If neither feels right, ask the user before writing. Create any missing parent
directories.

## File contents

Write this file verbatim. Do not widen the env allowlist or expose secrets
unless the user explicitly asks for those env vars.

```ts
import { exec as execCb } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { FileStat, SandboxFactory, SessionEnv, ShellResult } from '@flue/runtime';

const execAsync = promisify(execCb);

const DEFAULT_LOCAL_ENV_ALLOWLIST = [
	'PATH',
	'HOME',
	'USER',
	'LOGNAME',
	'HOSTNAME',
	'SHELL',
	'LANG',
	'LC_ALL',
	'LC_CTYPE',
	'TZ',
	'TERM',
	'TMPDIR',
	'TMP',
	'TEMP',
] as const;

export interface LocalSandboxOptions {
	cwd?: string;
	env?: Record<string, string | undefined>;
}

function abortErrorFor(signal: AbortSignal): Error {
	const reason = signal.reason;
	const message =
		reason instanceof Error && reason.message
			? reason.message
			: typeof reason === 'string' && reason
				? reason
				: 'The operation was aborted.';
	const error = new DOMException(message, 'AbortError');
	try {
		Object.defineProperty(error, 'cause', { value: reason, configurable: true });
	} catch {
		return error;
	}
	return error;
}

function resolveBaseEnv(userEnv: LocalSandboxOptions['env']): NodeJS.ProcessEnv {
	if (userEnv !== undefined && (typeof userEnv !== 'object' || Array.isArray(userEnv))) {
		throw new TypeError(
			'[flue] local() `env` must be a Record<string, string | undefined>. ' +
				'To inherit the full host env, pass `env: { ...process.env }`.',
		);
	}

	const base: NodeJS.ProcessEnv = {};
	for (const key of DEFAULT_LOCAL_ENV_ALLOWLIST) {
		const value = process.env[key];
		if (value !== undefined) base[key] = value;
	}
	if (!userEnv) return base;
	for (const [key, value] of Object.entries(userEnv)) {
		if (value === undefined) delete base[key];
		else base[key] = value;
	}
	return base;
}

function createLocalSessionEnv(options: LocalSandboxOptions = {}): SessionEnv {
	const cwd = path.resolve(options.cwd ?? process.cwd());
	const baseEnv = resolveBaseEnv(options.env);
	const resolvePath = (p: string): string => (path.isAbsolute(p) ? p : path.resolve(cwd, p));

	return {
		async exec(command, opts): Promise<ShellResult> {
			const signal = opts?.signal;
			if (signal?.aborted) throw abortErrorFor(signal);
			const timeoutSignal =
				typeof opts?.timeout === 'number'
					? AbortSignal.timeout(opts.timeout * 1000)
					: undefined;
			const mergedSignal =
				signal && timeoutSignal
					? AbortSignal.any([signal, timeoutSignal])
					: (signal ?? timeoutSignal);

			try {
				const { stdout, stderr } = await execAsync(command, {
					cwd: opts?.cwd ? resolvePath(opts.cwd) : cwd,
					env: opts?.env ? { ...baseEnv, ...opts.env } : baseEnv,
					signal: mergedSignal,
					encoding: 'utf8',
					maxBuffer: 64 * 1024 * 1024,
				});
				if (signal?.aborted) throw abortErrorFor(signal);
				return { stdout, stderr, exitCode: 0 };
			} catch (err: any) {
				if (signal?.aborted) throw abortErrorFor(signal);
				if (err && typeof err === 'object' && 'code' in err) {
					return {
						stdout: typeof err.stdout === 'string' ? err.stdout : '',
						stderr: typeof err.stderr === 'string' ? err.stderr : String(err.message ?? ''),
						exitCode: typeof err.code === 'number' ? err.code : 1,
					};
				}
				throw err;
			}
		},
		async readFile(p) {
			return fs.readFile(resolvePath(p), 'utf8');
		},
		async readFileBuffer(p) {
			const buf = await fs.readFile(resolvePath(p));
			return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
		},
		async writeFile(p, content) {
			const resolved = resolvePath(p);
			const dir = path.dirname(resolved);
			if (dir && dir !== resolved) await fs.mkdir(dir, { recursive: true });
			await fs.writeFile(resolved, content);
		},
		async stat(p): Promise<FileStat> {
			const s = await fs.stat(resolvePath(p));
			return {
				isFile: s.isFile(),
				isDirectory: s.isDirectory(),
				isSymbolicLink: s.isSymbolicLink(),
				size: s.size,
				mtime: s.mtime,
			};
		},
		async readdir(p) {
			return fs.readdir(resolvePath(p));
		},
		async exists(p) {
			try {
				await fs.access(resolvePath(p));
				return true;
			} catch {
				return false;
			}
		},
		async mkdir(p, opts) {
			await fs.mkdir(resolvePath(p), { recursive: opts?.recursive ?? false });
		},
		async rm(p, opts) {
			await fs.rm(resolvePath(p), {
				recursive: opts?.recursive ?? false,
				force: opts?.force ?? false,
			});
		},
		cwd,
		resolvePath,
	};
}

export function local(options: LocalSandboxOptions = {}): SandboxFactory {
	return {
		createSessionEnv: async ({ cwd }) =>
			createLocalSessionEnv({
				cwd: options.cwd ?? cwd,
				env: options.env,
			}),
	};
}
```

## Required dependencies

No new provider SDK is required. This connector uses Node.js built-ins and the
project's existing `@flue/runtime` dependency. Use it only for Node-target Flue
projects, not Cloudflare Worker targets.

## Authentication

The connector itself has no authentication. It intentionally exposes only a
small shell-essential env allowlist. If the sandboxed process must see another
env var, wire it explicitly:

```ts
local({ env: { GH_TOKEN: process.env.GH_TOKEN } });
```

Never invent env var values, and never pass `{ ...process.env }` unless the
user explicitly accepts exposing their full host environment to sandboxed shell
commands.

## Wiring it into an agent

```ts
import type { ActionContext } from '@flue/runtime';
import { local } from '../connectors/local';

export const triggers = { webhook: true };

export default async function ({ init }: ActionContext) {
  const harness = await init({
    sandbox: local(),
    model: 'anthropic/claude-sonnet-4-6',
  });
  const session = await harness.session();
  return await session.shell('pwd');
}
```

## Verify

1. Run the user's typechecker.
2. Confirm the import path matches where you wrote `local.ts`.
3. Confirm the project is running on Flue's Node target.
4. Tell the user to run `flue dev --target node` or `flue run <agent> --target node`.
