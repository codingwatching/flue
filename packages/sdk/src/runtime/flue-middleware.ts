/**
 * Hono middleware that exposes Flue's built-in routes:
 *
 *   - `GET  /health`              → `{ status: 'ok' }`
 *   - `GET  /agents`              → manifest of registered agents
 *   - `POST /agents/:name/:id`    → invoke an agent (webhook / SSE / sync)
 *
 * The middleware is configured with a runtime config object describing which
 * agents are registered, which are webhook-accessible, and how to build a
 * `FlueContext` for an incoming request. The Node target's generated entry
 * uses this directly. The Cloudflare target does NOT use this — its routing
 * goes through Cloudflare's `routeAgentRequest()` (partyserver) to reach the
 * per-agent Durable Object, which then calls {@link handleAgentRequest}
 * directly. This module is pure HTTP-layer plumbing (Hono routes, error
 * propagation); the per-agent dispatch logic lives in `handle-agent.ts` and
 * is shared.
 *
 * This module is currently consumed only via `@flue/sdk/internal`. Phase 2
 * of the `app.ts` work will introduce a public, less-configured form that
 * users can mount in their own Hono app.
 */

import { Hono } from 'hono';
import { toHttpResponse, validateAgentRequest } from '../error-utils.ts';
import { RouteNotFoundError } from '../errors.ts';
import {
	handleAgentRequest,
	type AgentHandler,
	type CreateContextFn,
	type RunHandlerFn,
	type StartWebhookFn,
} from './handle-agent.ts';

/**
 * The shape of the manifest served at `GET /agents`. Mirrors what `build()`
 * writes to `dist/manifest.json` — a list of agent names with their trigger
 * metadata.
 */
export interface AgentManifest {
	agents: ReadonlyArray<{
		name: string;
		triggers: { webhook?: boolean };
	}>;
}

export interface FlueMiddlewareConfig {
	/** Manifest served at `GET /agents`. */
	manifest: AgentManifest;
	/**
	 * Map of agent name → handler function. Includes ALL agents (webhook and
	 * trigger-less); {@link FlueMiddlewareConfig.webhookAgents} is what
	 * gates HTTP exposure when not in local mode.
	 */
	handlers: Record<string, AgentHandler>;
	/**
	 * Agents reachable over HTTP when not in local mode. Trigger-less agents
	 * are excluded from this list; they're only invokable via `flue run` /
	 * `flue dev` (which set FLUE_MODE=local and pass `allowNonWebhook: true`).
	 *
	 * Accepts any iterable of names — caller can pass an array, Set, or
	 * generator. Snapshotted to an array once at app construction.
	 */
	webhookAgents: Iterable<string>;
	/**
	 * If true, the route accepts any registered agent — including
	 * trigger-less ones. Used by the Node target when `FLUE_MODE=local`.
	 */
	allowNonWebhook: boolean;
	/** Per-target `FlueContext` factory. See {@link CreateContextFn}. */
	createContext: CreateContextFn;
	/** Per-target webhook execution wrapper. Defaults to direct invocation. */
	startWebhook?: StartWebhookFn;
	/** Per-target foreground handler wrapper. Defaults to direct invocation. */
	runHandler?: RunHandlerFn;
}

/**
 * Build a Hono app with Flue's built-in routes. The Node target's generated
 * entry creates an instance, mounts no other routes, and serves it.
 *
 * Future: Phase 2 will export a `flue()` function with a different,
 * user-facing signature (e.g. zero-arg, drawing config from a registered
 * runtime singleton) so users can `app.use('*', flue())` in their own
 * `app.ts`. For now this is internal-only.
 */
export function createFlueApp(config: FlueMiddlewareConfig): Hono {
	const app = new Hono();

	// Pre-compute the validation inputs once. `validateAgentRequest`
	// expects arrays for both lists; converting per request is wasted
	// work. Snapshotting `Object.keys` is also fine here because the
	// handler map is built at module load and never mutated.
	const registeredAgents = Object.keys(config.handlers);
	const webhookAgents = Array.from(config.webhookAgents);

	app.get('/health', (c) => c.json({ status: 'ok' }));
	app.get('/agents', (c) => c.json(config.manifest));

	// Catch any method on the agent route so non-POSTs become 405 (instead
	// of Hono's default 404 for unmatched method). Throws are translated by
	// the onError handler into the canonical error envelope.
	app.all('/agents/:name/:id', async (c) => {
		const name = c.req.param('name');
		const id = c.req.param('id');

		// Validate method, name shape, registration, webhook-accessibility.
		// Throws FlueHttpError on any failure; caught by app.onError below.
		validateAgentRequest({
			method: c.req.method,
			name,
			id,
			registeredAgents,
			webhookAgents,
			allowNonWebhook: config.allowNonWebhook,
		});

		// `validateAgentRequest` above guarantees `name` is in `handlers`;
		// the non-null assertion is just to satisfy TS, which can't follow
		// the cross-call invariant.
		const handler = config.handlers[name]!;

		// Delegate to the shared per-agent dispatcher. Returns a Response
		// directly; Hono is happy to forward it.
		return handleAgentRequest({
			request: c.req.raw,
			agentName: name,
			id,
			handler,
			createContext: config.createContext,
			startWebhook: config.startWebhook,
			runHandler: config.runHandler,
		});
	});

	app.notFound((c) => {
		// Throw rather than return so the onError handler is the single
		// source of truth for error-envelope shaping.
		throw new RouteNotFoundError({
			method: c.req.method,
			path: new URL(c.req.url).pathname,
		});
	});

	// Single-source-of-truth error renderer. Every thrown FlueError (and
	// every thrown unknown) is converted to the canonical JSON envelope
	// here. toHttpResponse takes care of logging unknowns — no extra
	// console.error needed at this layer.
	app.onError((err) => toHttpResponse(err));

	return app;
}

// The public `flue()` Hono middleware form is intentionally NOT exported
// from this module yet — that surface lands in Phase 2 of the `app.ts`
// work. For Phase 1, the Node build plugin is the only consumer and it
// uses `createFlueApp` directly.
