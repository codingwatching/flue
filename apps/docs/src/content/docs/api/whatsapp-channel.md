---
title: WhatsApp Channel API
description: Reference for verified WhatsApp Business Cloud ingress from @flue/whatsapp.
lastReviewedAt: 2026-06-13
---

Import from `@flue/whatsapp`.

## `createWhatsAppChannel()`

```ts
function createWhatsAppChannel<E extends Env = Env>(
  options: WhatsAppChannelOptions<E>,
): WhatsAppChannel<E>;
```

Creates `GET /webhook` for endpoint verification and `POST /webhook` for
signed deliveries.

## `WhatsAppChannelOptions`

```ts
interface WhatsAppChannelOptions<E extends Env = Env> {
  appSecret: string;
  verifyToken: string;
  businessAccountId: string;
  phoneNumberId: string;
  bodyLimit?: number;
  webhook(input: WhatsAppWebhookHandlerInput<E>): WhatsAppHandlerResult;
}
```

| Field               | Description                                                    |
| ------------------- | -------------------------------------------------------------- |
| `appSecret`         | Meta app secret for exact-body HMAC-SHA256 verification.       |
| `verifyToken`       | User-chosen token for GET challenge verification.              |
| `businessAccountId` | Required `entry.id` for every delivery.                        |
| `phoneNumberId`     | Required `metadata.phone_number_id` for `messages` changes.    |
| `bodyLimit`         | Maximum POST body. Default: 3 \* 1024 \* 1024 bytes.           |
| `webhook`           | Callback for one verified delivery with every event preserved. |

```ts
type WhatsAppHandlerResult = void | JsonValue | Response | Promise<void | JsonValue | Response>;
```

Returning nothing produces an empty `200`. A JSON-compatible value becomes the
response body. An ordinary Hono or Fetch `Response` passes through.

## `WhatsAppChannel`

```ts
interface WhatsAppChannel<E extends Env = Env> {
  readonly routes: readonly ChannelRoute<E>[];
  conversationKey(ref: WhatsAppConversationRef): string;
  parseConversationKey(id: string): WhatsAppConversationRef;
}
```

A file named `channels/whatsapp.ts` serves GET and POST
`/channels/whatsapp/webhook` relative to the `flue()` mount.

The channel does not persist or deduplicate deliveries. Conversation keys are
canonical identifiers, not authorization capabilities.

## Deliveries

```ts
interface WhatsAppWebhookDelivery {
  object: 'whatsapp_business_account';
  events: readonly WhatsAppWebhookEvent[];
  raw: unknown;
}
```

`events` remains in signed entry, change, and item order. Each event exposes
`businessAccountId`, optional phone metadata, source indices, and verified
`raw`. Do not dispatch or persist raw payloads wholesale.

```ts
type WhatsAppWebhookEvent = WhatsAppMessageEvent | WhatsAppStatusEvent | WhatsAppUnknownEvent;
```

Message events expose `sender`, `conversation`, and a `WhatsAppMessage`
discriminated by `kind`:

- `text`
- `media`
- `location`
- `contacts`
- `interactive`
- `button`
- `reaction`
- `revoke`
- `unsupported`
- `unknown`

Media variants include the provider asset id, MIME type, hash, caption,
filename, and voice flag when supplied. Authenticated transport URLs remain
available only under verified `raw`.

Status events expose the outbound message id, provider status, timestamp,
recipient, optional callback data and conversation metadata, and normalized
errors. Known `state` values are `sent`, `delivered`, `read`, `played`, and
`failed`; other signed values use `unknown` while preserving `providerState`.

Unknown change fields use `WhatsAppUnknownEvent`.

## Identity

```ts
type WhatsAppConversationRef =
  | {
      type: 'individual';
      businessAccountId: string;
      phoneNumberId: string;
      recipientId: string;
    }
  | {
      type: 'group';
      businessAccountId: string;
      phoneNumberId: string;
      groupId: string;
    };
```

Individual `recipientId` is the inbound message `from` value or outbound status
recipient. `WhatsAppUserRef.userId` separately preserves `wa_id` when supplied.

## Errors

- `InvalidWhatsAppConversationKeyError`
- `InvalidWhatsAppInputError`, with structured `field`

See [WhatsApp setup](/docs/guide/channels/whatsapp/) for Meta configuration and
project-owned client composition.
