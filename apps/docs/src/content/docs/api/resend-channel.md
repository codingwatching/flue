---
title: Resend Channel API
description: Reference for verified Resend webhook ingress from @flue/resend.
lastReviewedAt: 2026-06-13
---

Import from `@flue/resend`.

## Exports

```ts
export {
  createResendChannel,
  type ChannelRoute,
  type JsonValue,
  type ResendChannel,
  type ResendChannelOptions,
  type ResendHandlerResult,
  type ResendKnownEventType,
  type ResendKnownWebhookEvent,
  type ResendUnknownWebhookEvent,
  type ResendWebhookDelivery,
  type ResendWebhookEvent,
  type ResendWebhookHandlerInput,
};
```

## `createResendChannel()`

```ts
function createResendChannel<E extends Env = Env>(
  options: ResendChannelOptions<E>,
): ResendChannel<E>;
```

Creates one stateless Resend webhook channel. The callback runs only after the
official Resend client verifies the exact request body and signed Svix headers.

## `ResendChannelOptions`

```ts
interface ResendChannelOptions<E extends Env = Env> {
  client: Resend;
  webhookSecret: string;
  bodyLimit?: number;
  webhook(input: ResendWebhookHandlerInput<E>): ResendHandlerResult;
}
```

| Field           | Description                                                  |
| --------------- | ------------------------------------------------------------ |
| `client`        | Project-owned official Resend SDK client.                    |
| `webhookSecret` | Signing secret for this Resend webhook endpoint.             |
| `bodyLimit`     | Maximum request-body size in bytes. Defaults to 1 MiB.       |
| `webhook`       | Receives each verified and structurally valid webhook event. |

The constructor throws `TypeError` for a missing compatible client, empty
signing secret, missing callback, or non-positive integer body limit.

## Handler input

```ts
interface ResendWebhookHandlerInput<E extends Env = Env> {
  c: Context<E>;
  event: ResendWebhookEvent;
  delivery: ResendWebhookDelivery;
}

interface ResendWebhookDelivery {
  id: string;
  timestamp: string;
}
```

`c` is the authentic Hono context. `delivery.id` is the signed `svix-id` Resend
documents for application-owned deduplication. `delivery.timestamp` is the
signed Unix timestamp string from `svix-timestamp`.

Resend provides at-least-once delivery and does not guarantee ordering. The
channel exposes delivery metadata but does not persist deduplication state or
reorder events.

## Handler result

```ts
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type ResendHandlerResult =
  | undefined
  | JsonValue
  | Response
  | Promise<undefined | JsonValue | Response>;
```

Returning nothing produces an empty `200`. A JSON-compatible value becomes a
JSON response. A normal Hono or Fetch `Response` passes through unchanged.
Thrown callbacks and unsupported return values produce an empty `500`.

Resend treats only `200` as a successful delivery and retries other statuses.
Returning a non-`200` `Response` therefore requests redelivery. The package
does not impose a handler deadline.

## `ResendChannel`

```ts
interface ResendChannel<E extends Env = Env> {
  readonly routes: readonly ChannelRoute<E>[];
}

interface ChannelRoute<E extends Env = Env> {
  readonly method: string;
  readonly path: string;
  readonly handler: Handler<E>;
}
```

`routes` contains one `POST /webhook` declaration. A file named
`channels/resend.ts` is served at `POST /channels/resend/webhook` relative to
the `flue()` mount.

The package does not expose conversation-key helpers. In particular,
`message_id` identifies one email message rather than a stable thread root.
Applications define any message grouping or reply-thread identity appropriate
to their own persistence and authorization model.

## `ResendWebhookEvent`

```ts
type ResendWebhookEvent = ResendKnownWebhookEvent | ResendUnknownWebhookEvent;

type ResendKnownWebhookEvent = Extract<WebhookEventPayload, { type: ResendKnownEventType }>;
```

`ResendKnownWebhookEvent` retains provider-native SDK variants for the event
names validated by this package:

- Email: `email.sent`, `email.scheduled`, `email.delivered`,
  `email.delivery_delayed`, `email.complained`, `email.bounced`,
  `email.opened`, `email.clicked`, `email.received`, `email.failed`, and
  `email.suppressed`
- Contacts: `contact.created`, `contact.updated`, and `contact.deleted`
- Domains: `domain.created`, `domain.updated`, and `domain.deleted`

Known events retain the SDK's `type`, `created_at`, and event-specific `data`
fields. `email.received` contains message metadata and attachment descriptors,
not the complete body or attachment content. Retrieve those later through the
project-owned `Resend` client.

## Unknown event normalization

```ts
interface ResendUnknownWebhookEvent {
  type: 'unknown';
  eventType: string;
  createdAt: string;
  data: Record<string, unknown>;
  raw: unknown;
}
```

A structurally valid, verified event whose provider `type` is not in
`ResendKnownEventType` is normalized to `type: 'unknown'`. `eventType`
preserves the provider event type, `createdAt` copies `created_at`, `data`
preserves the provider data object, and `raw` contains the complete parsed
payload.

Unknown normalization still requires a non-empty provider event type, a
parseable `created_at`, and an object-valued `data` field.

## Verification

The route requires `application/json` plus non-empty `svix-id`,
`svix-timestamp`, and `svix-signature` headers. `svix-timestamp` must be a
positive integer.

The channel retains the exact request bytes, decodes them as strict UTF-8, and
calls:

```ts
client.webhooks.verify({
  payload,
  headers: {
    id: delivery.id,
    timestamp: delivery.timestamp,
    signature,
  },
  webhookSecret,
});
```

The official SDK verifies the signature and timestamp before application code
runs. Unsupported media types receive `415`; oversized bodies receive `413`;
missing or malformed headers, invalid UTF-8, failed verification, malformed
JSON, and invalid event shapes receive `400`.

## Application boundary

Receiving domains and MX records, webhook registration, API keys and signing
secrets, deduplication, ordering recovery, message persistence, full body and
attachment retrieval, outbound mail, replies, and model tools remain
application concerns.

The SDK's public declarations reference `Buffer` and React email types, so
TypeScript consumers require `@types/node` and `@types/react`. Both peers are
declaration-only and add no Node or React runtime code to a Worker bundle. The
official client and verification path execute in Node and workerd without
`nodejs_compat`.

See [Resend setup](/docs/guide/channels/resend/) for the project-owned client,
message retrieval, delivery handling, and offline testing guidance.
