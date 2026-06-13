import { WhatsAppClient } from '@kapso/whatsapp-cloud-api';
import { describe, expect, it, vi } from 'vitest';

describe('WhatsAppClient', () => {
	it('sends individual and group text messages through Fetch in workerd', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(
				Response.json({
					messaging_product: 'whatsapp',
					contacts: [{ input: '+15557006101', wa_id: 'user_6101' }],
					messages: [{ id: 'wamid_outbound_individual' }],
				}),
			)
			.mockResolvedValueOnce(
				Response.json({
					messaging_product: 'whatsapp',
					messages: [{ id: 'wamid_outbound_group' }],
				}),
			);
		const client = new WhatsAppClient({
			accessToken: 'synthetic-access-token',
			graphVersion: 'v25.0',
			fetch,
		});

		const individual = await client.messages.sendText({
			phoneNumberId: 'phone_worker_61',
			to: '+15557006101',
			body: 'Individual response',
		});
		const group = await client.messages.sendText({
			phoneNumberId: 'phone_worker_61',
			recipientType: 'group',
			to: 'group_worker_61',
			body: 'Group response',
		});

		expect(individual.messages[0]?.id).toBe('wamid_outbound_individual');
		expect(group.messages[0]?.id).toBe('wamid_outbound_group');
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(String(fetch.mock.calls[0]?.[0])).toBe(
			'https://graph.facebook.com/v25.0/phone_worker_61/messages',
		);
		expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
			Authorization: 'Bearer synthetic-access-token',
		});
		expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
			messaging_product: 'whatsapp',
			recipient_type: 'individual',
			to: '+15557006101',
			type: 'text',
			text: { body: 'Individual response' },
		});
		expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
			messaging_product: 'whatsapp',
			recipient_type: 'group',
			to: 'group_worker_61',
			type: 'text',
			text: { body: 'Group response' },
		});
	});
});
