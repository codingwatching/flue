import { WhatsAppClient } from '@kapso/whatsapp-cloud-api';
import { describe, expect, it, vi } from 'vitest';

describe('WhatsAppClient', () => {
	it('sends a text message through Fetch in Node', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
			Response.json({
				messaging_product: 'whatsapp',
				contacts: [{ input: '+15557006202', wa_id: 'user_6202' }],
				messages: [{ id: 'wamid_outbound_node' }],
			}),
		);
		const client = new WhatsAppClient({
			accessToken: 'synthetic-node-access-token',
			graphVersion: 'v25.0',
			fetch,
		});

		const result = await client.messages.sendText({
			phoneNumberId: 'phone_node_62',
			to: '+15557006202',
			body: 'Node response',
		});

		expect(result.messages[0]?.id).toBe('wamid_outbound_node');
		expect(String(fetch.mock.calls[0]?.[0])).toBe(
			'https://graph.facebook.com/v25.0/phone_node_62/messages',
		);
		expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
			messaging_product: 'whatsapp',
			recipient_type: 'individual',
			to: '+15557006202',
			type: 'text',
			text: { body: 'Node response' },
		});
	});
});
