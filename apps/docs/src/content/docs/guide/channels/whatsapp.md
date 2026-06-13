---
title: WhatsApp
description: Receive verified WhatsApp Business Cloud deliveries with a project-owned Fetch client.
---

## Add WhatsApp

Run the WhatsApp recipe through your coding agent:

```sh
flue add whatsapp --print | codex
```

It installs `@flue/whatsapp` for verified ingress and
`@kapso/whatsapp-cloud-api` for project-owned Graph API access. The client is
Fetch-based and runs in Node and Cloudflare Workers without `nodejs_compat`.

Set the callback URL to:

```txt
https://example.com/channels/whatsapp/webhook
```

## Channel module

```ts title="src/channels/whatsapp.ts"
import { createWhatsAppChannel, type WhatsAppConversationRef } from '@flue/whatsapp';
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
      if (event.type !== 'message' || event.message.kind !== 'text') continue;
      await dispatch(assistant, {
        id: channel.conversationKey(event.conversation),
        input: {
          type: 'whatsapp.text',
          messageId: event.message.id,
          sender: event.sender,
          text: event.message.text,
        },
      });
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

Bind the tool from the agent with
`postMessage(channel.parseConversationKey(id))`. Trusted application code
selects the destination; the model selects only message text.

## Configure the webhook

Configure the Meta app with the route above and a random
`WHATSAPP_VERIFY_TOKEN`. Subscribe the WhatsApp Business Account to the
`messages` field.

Meta sends GET requests for `hub.challenge` verification and signs POST bodies
with the app secret in `X-Hub-Signature-256`. The package verifies exact bytes,
then checks the configured business-account and phone-number ids before
invoking application code.

Use a system-user or business access token for production outbound calls. Keep
Graph API versions explicit and test an upgrade before changing them.

## Delivery behavior

One POST can contain many entries, changes, messages, and statuses. The callback
runs once with the complete verified delivery, and `delivery.events` preserves
provider order.

Returning nothing produces an empty `200`. Meta retries failed deliveries for
up to seven days, so claim message ids in durable application storage before
dispatch when duplicates are unacceptable.

Known message variants cover text, media, location, shared contacts,
interactive replies, buttons, reactions, revocations, unsupported payloads,
and future unknown types. Status variants preserve provider state and outbound
message identity.

## Conversation identity

Individual destinations use the inbound sender phone number because that is the
value accepted by the send API. Meta's separate `wa_id` remains sender metadata
because the two values may differ. Group destinations use the provider group
id.

Normalized media includes the stable asset id but omits bearer-authenticated
download URLs. Use the project-owned client for retrieval, and avoid forwarding
raw provider payloads into model context.

See the [`@flue/whatsapp` API reference](/docs/api/whatsapp-channel/).
