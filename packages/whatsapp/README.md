# @flue/whatsapp

Verified WhatsApp Business Cloud webhook ingress for Flue channels.

```ts
import { createWhatsAppChannel } from '@flue/whatsapp';

export const channel = createWhatsAppChannel({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
  businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID!,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  webhook({ delivery }) {
    // Handle every event in one verified Meta delivery.
  },
});
```

The package owns GET verification, exact-body signature validation, fixed
business identity checks, typed event normalization, batch preservation,
response handling, and canonical conversation identity. Applications own
access tokens, outbound clients, tools, dispatch policy, and deduplication.

See the prepared package docs or
<https://flueframework.com/docs/guide/channels/whatsapp/>.
