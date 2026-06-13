import { createWhatsAppChannel, type WhatsAppConversationRef } from '@flue/whatsapp';
import { defineTool, dispatch } from '@flue/runtime';
import { WhatsAppClient } from '@kapso/whatsapp-cloud-api';
import assistant from '../agents/assistant.ts';

export const client = new WhatsAppClient({
	accessToken: requiredEnv('WHATSAPP_ACCESS_TOKEN'),
	graphVersion: 'v25.0',
});

export const channel = createWhatsAppChannel({
	appSecret: requiredEnv('WHATSAPP_APP_SECRET'),
	verifyToken: requiredEnv('WHATSAPP_VERIFY_TOKEN'),
	businessAccountId: requiredEnv('WHATSAPP_BUSINESS_ACCOUNT_ID'),
	phoneNumberId: requiredEnv('WHATSAPP_PHONE_NUMBER_ID'),

	// Paths: GET and POST /channels/whatsapp/webhook
	async webhook({ delivery }) {
		for (const event of delivery.events) {
			switch (event.type) {
				case 'message': {
					if (event.message.kind !== 'text' && event.message.kind !== 'interactive') {
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
					break;
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
		description: 'Post a message to the WhatsApp conversation bound to this agent.',
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

function requiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required.`);
	return value;
}
