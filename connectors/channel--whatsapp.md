---
{
  "category": "channel",
  "website": "https://developers.facebook.com/docs/whatsapp/cloud-api"
}
---

# Add a WhatsApp Channel to Flue

You are an AI coding agent adding verified WhatsApp Business Cloud webhook
ingress with project-owned outbound WhatsApp access to a Flue project.

## Inspect the project

Read local instructions, detect the package manager and target, and select the
first existing source root: `<root>/.flue/`, then `<root>/src/`, then
`<root>/`. Inspect existing agents, environment types, secret conventions, and
which WhatsApp message families the application handles.

Install `@flue/whatsapp` and `@kapso/whatsapp-cloud-api@^0.2.1`. Flue owns GET
verification, exact-body POST signature verification, fixed business identity,
batch preservation, and event normalization. The project owns the access token,
full outbound client, tools, dispatch policy, and durable deduplication.

The SDK root export is Fetch-based and executes in Node and Cloudflare Workers
without `nodejs_compat`. Do not import its `/server` subpath for ordinary
messaging. Keep a workerd fake-transport test for every client operation the
project relies on.

## Create the channel

Create `<source-dir>/channels/whatsapp.ts`. Adapt the imported agent,
dispatched input, handled events, and tool:

```ts
import {
  createWhatsAppChannel,
  type WhatsAppConversationRef,
} from '@flue/whatsapp';
import { defineTool, dispatch } from '@flue/runtime';
import { WhatsAppClient } from '@kapso/whatsapp-cloud-api';
import assistant from '../agents/assistant.ts';

export const client = new WhatsAppClient({
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN!,
  graphVersion: 'v25.0',
});

export const channel = createWhatsAppChannel({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
  businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID!,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,

  // Paths: GET and POST /channels/whatsapp/webhook
  async webhook({ delivery }) {
    for (const event of delivery.events) {
      switch (event.type) {
        case 'message': {
          if (
            event.message.kind !== 'text' &&
            event.message.kind !== 'interactive'
          ) {
            continue;
          }
          await dispatch(assistant, {
            id: channel.conversationKey(event.conversation),
            input: {
              type: `whatsapp.${event.message.kind}`,
              messageId: event.message.id,
              sender: event.sender,
              message: event.message,
            },
          });
          break;
        }
        case 'status':
        case 'unknown':
          break;
      }
    }
  },
});

export function postMessage(ref: WhatsAppConversationRef) {
  const to = ref.type === 'group' ? ref.groupId : ref.recipientId;
  return defineTool({
    name: 'post_whatsapp_message',
    description: 'Post to the WhatsApp conversation bound to this agent.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 4096 },
      },
      required: ['text'],
      additionalProperties: false,
    },
    async execute({ text }) {
      const result = await client.messages.sendText({
        phoneNumberId: ref.phoneNumberId,
        recipientType: ref.type,
        to,
        body: text,
      });
      return JSON.stringify({ messageId: result.messages[0]?.id });
    },
  });
}
```

Use the current Graph API version supported by the project. `v25.0` is current
when this recipe was authored; keep version upgrades explicit and tested.

## Wire the agent

```ts
import { createAgent } from '@flue/runtime';
import { channel, postMessage } from '../channels/whatsapp.ts';

export default createAgent(({ id }) => ({
  model: 'anthropic/claude-haiku-4-5',
  tools: [postMessage(channel.parseConversationKey(id))],
}));
```

The channel-agent import cycle is supported because imported bindings are read
inside deferred callbacks and initializers.

## Configure Meta

Set:

```txt
WHATSAPP_APP_SECRET=...
WHATSAPP_VERIFY_TOKEN=...
WHATSAPP_BUSINESS_ACCOUNT_ID=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_ACCESS_TOKEN=...
```

Generate `WHATSAPP_VERIFY_TOKEN` independently. In the Meta app dashboard,
configure this callback URL and token:

```txt
https://example.com/channels/whatsapp/webhook
```

Subscribe the WhatsApp Business Account to the `messages` webhook field. Meta
uses GET on the route for `hub.challenge` verification and POST for JSON
deliveries signed through `X-Hub-Signature-256`.

The package verifies the exact POST bytes before parsing and then requires
every entry and `messages` change to match the configured business account and
phone-number ids. Do not expose the app secret, verify token, or access token
to the model.

## Handle deliveries

One POST may contain multiple entries, changes, messages, and statuses.
`delivery.events` preserves provider order and invokes the application callback
once for the complete verified delivery. Process every applicable event before
returning success.

Returning nothing produces an empty `200`. A JSON-compatible value becomes the
response body. Return a normal Hono or Fetch `Response` for explicit status
control.

Meta retries non-`200` deliveries with decreasing frequency for up to seven
days, so duplicates are expected. The package is stateless and exposes message
ids and event positions without claiming deduplication. Claim durable ids
before dispatch when duplicate admission is unacceptable.

Known message families include text, media, location, shared contacts,
interactive replies, legacy buttons, reactions, revocations, unsupported
messages, and future unknown message types. Status events preserve sent,
delivered, read, played, failed, and unknown provider states.

## Respect identity boundaries

Individual identity includes the fixed business phone number and the inbound
`from` value used as the outbound destination. Group identity uses the
provider's group id. Sender `wa_id` remains separate because Meta documents
that it may differ from the sender phone number.

Media download URLs are omitted from normalized media objects because they are
bearer-authenticated transport details. Use the verified media id and the
project-owned client when media retrieval is required. Do not dispatch
`event.raw` or `delivery.raw` wholesale.

## Test without Meta

Create original synthetic payloads from the current official schemas and cover:

- GET challenge success, changed tokens, and duplicate query parameters;
- exact-body HMAC verification with changed bytes and Unicode;
- fixed business-account and phone-number identity mismatches;
- multiple entries, changes, messages, statuses, and unknown fields;
- text, media, location, contacts, interactive replies, reactions,
  revocations, unsupported messages, and unknown message types;
- malformed JSON, content type, body limits, and response behavior;
- individual and group conversation-key round trips;
- real SDK requests against an injected fake Fetch transport in workerd;
- Node and Cloudflare project builds.

Do not contact Meta or copy third-party fixtures.
