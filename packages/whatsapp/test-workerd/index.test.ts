import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createWhatsAppChannel } from '../src/index.ts';

const encoder = new TextEncoder();

describe('@flue/whatsapp workerd ingress', () => {
	it('verifies exact bytes and preserves batched events in workerd', async () => {
		const webhook = vi.fn();
		const whatsapp = createWhatsAppChannel({
			appSecret: 'worker_app_secret',
			verifyToken: 'worker_verify_token',
			businessAccountId: 'waba_worker_17',
			phoneNumberId: 'phone_worker_17',
			webhook,
		});
		const app = new Hono();
		for (const route of whatsapp.routes) {
			app.on(route.method, route.path, route.handler);
		}
		const body = `{"entry":[{"changes":[{"value":{"messages":[{"text":{"body":"Worker delivery"},"type":"text","timestamp":"1781200501","from":"+15557005017","id":"wamid_worker_17"}],"metadata":{"phone_number_id":"phone_worker_17","display_phone_number":"+1 555 700 5017"},"messaging_product":"whatsapp"},"field":"messages"}],"id":"waba_worker_17"}],"object":"whatsapp_business_account"}`;
		const signature = await hmac('worker_app_secret', body);

		const accepted = await app.request(
			new Request('https://example.test/webhook', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-hub-signature-256': `sha256=${signature}`,
				},
				body,
			}),
		);
		const changed = await app.request(
			new Request('https://example.test/webhook', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-hub-signature-256': `sha256=${signature}`,
				},
				body: body.replace('Worker delivery', 'Changed delivery'),
			}),
		);
		const challenge = await app.request(
			'https://example.test/webhook?hub.mode=subscribe&hub.challenge=worker-challenge&hub.verify_token=worker_verify_token',
		);

		expect(accepted.status).toBe(200);
		expect(changed.status).toBe(401);
		expect(challenge.status).toBe(200);
		expect(await challenge.text()).toBe('worker-challenge');
		expect(webhook).toHaveBeenCalledOnce();
		expect(webhook.mock.calls[0]?.[0].delivery.events).toMatchObject([
			{
				type: 'message',
				message: { kind: 'text', text: 'Worker delivery' },
				conversation: {
					type: 'individual',
					recipientId: '+15557005017',
				},
			},
		]);
	});
});

async function hmac(secret: string, body: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
	return Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
