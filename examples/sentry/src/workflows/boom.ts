/**
 * Run-fatal failure workflow.
 *
 * This handler throws unconditionally. Flue catches the throw,
 * emits a `run_end` event with `isError: true` and a serialized
 * error payload, then returns an HTTP error envelope to the caller.
 *
 * The `observe(...)` subscriber in `app.ts` sees the `run_end`
 * event, reconstructs the Error, and calls `Sentry.captureException`
 * with `flue.run.id`, `flue.workflow`, and friends as tags.
 *
 * Invoke:
 *
 *   curl -X POST http://localhost:3583/workflows/boom?wait=result \
 *     -H 'content-type: application/json' \
 *     -d '{}'
 *
 * Expected:
 *   - HTTP 500 from Flue with a structured error envelope.
 *   - One issue in Sentry, tagged `flue.workflow=boom`, `flue.run.id=run_01...`.
 *
 * Notice: the handler does not import Sentry. It does not know that
 * error reporting exists. That separation is the whole point — every
 * Flue workflow in this project is instrumented for Sentry by virtue of
 * living in this project, without any per-workflow boilerplate.
 */
import type { FlueContext, WorkflowRouteHandler } from '@flue/runtime';

export const route: WorkflowRouteHandler = async (_c, next) => next();

export async function run(ctx: FlueContext) {
	// `log.info` is just a normal Flue structured log. It appears in
	// the run's event stream (and in `flue logs <runId>`) but is NOT
	// sent to Sentry — only `log.error` is.
	ctx.log.info('boom workflow about to explode', { reason: 'demo' });

	throw new Error('intentional explosion for the Sentry demo');
}
