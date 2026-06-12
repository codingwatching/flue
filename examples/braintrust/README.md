# Braintrust tracing for Flue

A Node-focused example that maps Flue's public `observe(...)` stream into Braintrust spans without importing `@flue/runtime/internal` or patching runtime implementation files.

## What it demonstrates

- Workflow runs become root Braintrust spans.
- Flue operations become child spans.
- `turn_request` / `turn` pairs become `llm` spans containing model-visible input, output, provider/model identity, and usage/cost metrics.
- Tool calls, child tasks, and compactions become nested spans using Flue correlation fields.
- Token and cost metrics are recorded on model-turn leaf spans; enclosing operation and compaction spans retain rolled-up usage as metadata so totals are not double-counted.

The integration is entirely in [`src/app.ts`](src/app.ts). Workflows do not import Braintrust.

## Why `observe(...)`

`observe(...)` is Flue's public semantic integration contract. It reports workflows, operations, model turns, tools, tasks, and compactions with stable correlation fields. Braintrust may separately provide wrappers or Node auto-instrumentation to activate span context around live provider calls, but those optional mechanisms are not required to construct a Flue semantic trace from events.

The bridge intentionally uses only Braintrust's public logger/span APIs and Flue's public events:

```ts
import { observe } from '@flue/runtime';
import { initLogger } from 'braintrust';

const logger = process.env.BRAINTRUST_API_KEY
  ? initLogger({ projectName: 'Flue', apiKey: process.env.BRAINTRUST_API_KEY })
  : undefined;

observe((event) => {
  if (!logger) return;
  // Convert correlated Flue lifecycle events into Braintrust spans.
});
```

## Trace shape

For a tool-using workflow, the generated structure is:

```text
workflow:tools
  flue.prompt
    llm:<model>
      tool:lookup_weather
    llm:<model>
```

The bridge uses:

| Flue events                       | Braintrust representation |
| --------------------------------- | ------------------------- |
| `run_start` / `run_end`           | root `task` span          |
| `operation_start` / `operation`   | nested `task` span        |
| `turn_request` / `turn`           | nested `llm` span         |
| `tool_start` / `tool`        | nested `tool` span        |
| `task_start` / `task`             | nested `task` span        |
| `compaction_start` / `compaction` | nested `task` span        |

Workflows are the only Flue executions represented as runs. For direct or dispatched persistent-agent input, `operationId` is the finite trace boundary and `instanceId`, `session`, and optional `dispatchId` should be retained as attributes.

## Sensitive content

Flue events are content-bearing. This custom `observe(...)` bridge intentionally sends workflow payloads/results, operation results, task prompts/results, tool arguments/results, model-visible messages, outputs, system prompts, tool definitions, and supported reasoning data to Braintrust. Add filtering or redaction before enabling it for production or sensitive workloads, and run it only where Braintrust retention and access policies are appropriate for that content. The official OpenTelemetry adapter defaults to metadata-only export and requires an application-owned `exportContent` callback before exporting content. See [Observability](https://flueframework.com/docs/guide/observability/) for guidance.

## Files

```text
examples/braintrust/
├── AGENTS.md
├── flue.config.ts
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── app.ts
    └── workflows/
        ├── prompt.ts
        ├── tools.ts
        └── task.ts
```

## Running it

From the repository root, install workspace dependencies:

```bash
pnpm install
```

Set credentials for Braintrust trace export and Anthropic model calls:

```bash
export BRAINTRUST_API_KEY='<braintrust-api-key>'
export BRAINTRUST_PROJECT_NAME='Flue'
export ANTHROPIC_API_KEY='<anthropic-api-key>'
```

If `BRAINTRUST_API_KEY` is unset, the bridge does not initialize Braintrust and the workflows still run normally.

From this example directory, start the Node dev server:

```bash
pnpm exec flue dev
```

Trigger the example workflows:

```bash
curl -X POST 'http://localhost:3583/workflows/prompt?wait=result' \
  -H 'content-type: application/json' \
  -d '{"name":"Developer"}'

curl -X POST 'http://localhost:3583/workflows/tools?wait=result' \
  -H 'content-type: application/json' \
  -d '{"city":"San Francisco"}'

curl -X POST 'http://localhost:3583/workflows/task?wait=result' \
  -H 'content-type: application/json' \
  -d '{"draft":"We are leveraging synergies to move faster."}'
```

## Current integration boundary

This example creates completed Braintrust spans from public Flue events. It does not attempt to establish active Braintrust async context during underlying provider invocation. If a Braintrust integration needs separately auto-instrumented provider SDK spans to inherit a live parent, that remains an optional Braintrust wrapper/auto-instrumentation concern rather than a dependency on Flue private internals.
