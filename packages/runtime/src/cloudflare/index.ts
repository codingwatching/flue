export interface VirtualSandboxOptions {
	prefix?: string;
}

export function getVirtualSandbox(): never;
export function getVirtualSandbox(bucket: unknown, options?: VirtualSandboxOptions): never;
export function getVirtualSandbox(bucket?: unknown, _options?: VirtualSandboxOptions): never {
	if (bucket === undefined) {
		throw new Error(
			'[flue] getVirtualSandbox() has been removed because Flue already creates the default in-memory sandbox. ' +
				'Write `await init({ model: "provider/model" })` or pass `sandbox: false` instead.',
		);
	}
	throw new Error(
		'[flue] getVirtualSandbox(bucket) has been removed because R2 is not a live mounted agent filesystem. ' +
			'Run `flue add cloudflare-shell`, import `getShellSandbox` and `hydrateFromBucket` from your generated `connectors/cloudflare-shell` file, hydrate the workspace, then pass `sandbox: getShellSandbox(...)` to init().',
	);
}

export function hydrateFromBucket(..._args: unknown[]): never {
	throw new Error(
		'[flue] hydrateFromBucket() is no longer exported from @flue/runtime/cloudflare because hydration belongs to the Cloudflare Shell connector. ' +
			'Run `flue add cloudflare-shell`, then write `import { hydrateFromBucket } from "../connectors/cloudflare-shell"`.',
	);
}

export { cfSandboxToSessionEnv } from './cf-sandbox.ts';

export { runWithCloudflareContext, getCloudflareContext } from './context.ts';
export type { CloudflareContext } from './context.ts';

export { getCloudflareAIBindingApiProvider } from './workers-ai-provider.ts';

export type { CloudflareGatewayOptions } from './gateway.ts';

export { FlueRegistry } from './registry-do.ts';
export { createCloudflareRunRegistry } from './run-registry.ts';
