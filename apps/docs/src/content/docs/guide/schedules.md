---
title: Schedules
description: Run Flue agents on a schedule with Cloudflare or Node.js.
lastReviewedAt: 2026-06-19
---

Agents often need to run without an incoming request, such as for daily summaries, recurring reports, data synchronization, or cleanup.

Flue does not prescribe a scheduling library; nor do we build scheduling into the framework itself. Instead, use the scheduling tools provided by your deployment environment and send the resulting input to an agent with `dispatch(...)`. This guide uses Cloudflare Cron Triggers and Croner for Node.js.

## Scheduling on Cloudflare

Add a [Cron Trigger](https://developers.cloudflare.com/workers/configuration/cron-triggers/) to your project's `wrangler.jsonc`:

```jsonc title="wrangler.jsonc"
{
  "triggers": {
    "crons": ["0 9 * * *"],
  },
}
```

Then define the handler in `src/cloudflare.ts` and dispatch the scheduled input to an agent:

```ts title="src/cloudflare.ts"
import { dispatch } from '@flue/runtime';
import dailySummary from './agents/daily-summary.ts';

export default {
  async scheduled(controller: ScheduledController) {
    await dispatch(dailySummary, {
      id: 'daily-summary',
      input: {
        type: 'schedule',
        prompt: 'Review recent activity and prepare the daily summary.',
        scheduledAt: new Date(controller.scheduledTime).toISOString(),
      },
    });
  },
};
```

Cron Triggers use UTC. See Cloudflare's [`scheduled()` handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/) documentation for the complete API.

## Scheduling on Node.js

Node.js does not include a built-in cron scheduler, so you will need to choose an ecosystem option that fits how your application is deployed. This example uses [Croner](https://croner.56k.guru/), a popular lightweight scheduler with async callbacks, overlap protection, and timezone support.

```ts title="src/app.ts"
import { dispatch } from '@flue/runtime';
import { Cron } from 'croner';
import dailySummary from './agents/daily-summary.ts';

new Cron(
  '0 9 * * *',
  {
    protect: true,
    timezone: 'UTC',
    catch: (error) => console.error('Scheduled agent admission failed', error),
  },
  async () => {
    await dispatch(dailySummary, {
      id: 'daily-summary',
      input: {
        type: 'schedule',
        prompt: 'Review recent activity and prepare the daily summary.',
        scheduledAt: new Date().toISOString(),
      },
    });
  },
);
```

For production schedules that must survive restarts or coordinate across replicas, we suggest a more persistent scheduler, such as BullMQ. An in-process scheduler like Croner only runs while that Node process is alive.

## Next steps

- [Agents](/docs/guide/building-agents/) — create the agent that receives scheduled input.
- [Workflows](/docs/guide/workflows/) — create and expose finite scheduled operations.
- [Cloudflare](/docs/guide/targets/cloudflare/) — configure the Cloudflare target and `cloudflare.ts` entrypoint.
- [Node.js](/docs/guide/targets/node/) — build and operate the generated Node.js server.
