import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import {
	createWhatsAppChannel,
	InvalidWhatsAppConversationKeyError,
	InvalidWhatsAppInputError,
	type WhatsAppChannel,
	type WhatsAppConversationRef,
} from '../src/index.ts';

const encoder = new TextEncoder();

describe('createWhatsAppChannel()', () => {
	it('answers the verification challenge when the configured token matches', async () => {
		const webhook = vi.fn();
		const whatsapp = createWhatsAppChannel({
			appSecret: 'app_secret_lilac',
			verifyToken: 'verify_token_lilac',
			businessAccountId: 'waba_8101',
			phoneNumberId: 'phone_9101',
			webhook,
		});
		const app = channelApp(whatsapp);

		const accepted = await app.request(
			'https://example.test/webhook?hub.mode=subscribe&hub.challenge=challenge-841&hub.verify_token=verify_token_lilac',
		);
		const rejected = await app.request(
			'https://example.test/webhook?hub.mode=subscribe&hub.challenge=challenge-841&hub.verify_token=verify_token_changed',
		);
		const duplicated = await app.request(
			'https://example.test/webhook?hub.mode=subscribe&hub.challenge=one&hub.challenge=two&hub.verify_token=verify_token_lilac',
		);

		expect(accepted.status).toBe(200);
		expect(await accepted.text()).toBe('challenge-841');
		expect(accepted.headers.get('content-type')).toBe('text/plain; charset=UTF-8');
		expect(rejected.status).toBe(403);
		expect(duplicated.status).toBe(400);
		expect(webhook).not.toHaveBeenCalled();
	});

	it('preserves a signed batch of messages, statuses, and unknown changes', async () => {
		const webhook = vi.fn();
		const whatsapp = createWhatsAppChannel({
			appSecret: 'app_secret_cedar',
			verifyToken: 'verify_token_cedar',
			businessAccountId: 'waba_8202',
			phoneNumberId: 'phone_9202',
			webhook,
		});
		const raw = {
			object: 'whatsapp_business_account',
			entry: [
				{
					id: 'waba_8202',
					changes: [
						{
							field: 'messages',
							value: {
								messaging_product: 'whatsapp',
								metadata: {
									display_phone_number: '+1 555 700 9202',
									phone_number_id: 'phone_9202',
								},
								contacts: [
									{
										wa_id: 'user_amber_14',
										profile: { name: 'Amber Quill' },
									},
								],
								messages: [
									{
										timestamp: '1781200101',
										type: 'text',
										id: 'wamid_text_cedar',
										from: '+15557001414',
										text: { body: 'Please inspect the edge cache.' },
										context: { forwarded: true },
									},
									{
										id: 'wamid_choice_cedar',
										from: '+15557001414',
										timestamp: '1781200102',
										type: 'interactive',
										group_id: 'group_ops_cedar',
										interactive: {
											type: 'list_reply',
											list_reply: {
												id: 'region_west',
												title: 'West region',
												description: 'Oregon and Washington',
											},
										},
									},
								],
								statuses: [
									{
										id: 'wamid_outbound_cedar',
										status: 'delivered',
										timestamp: '1781200103',
										recipient_id: '+15557001414',
										biz_opaque_callback_data: 'ticket_778',
										conversation: {
											id: 'conversation_cedar',
											origin: { type: 'service' },
										},
									},
								],
							},
						},
						{
							field: 'phone_number_quality_update',
							value: { event: 'FLAGGED' },
						},
					],
				},
			],
		};

		const response = await channelApp(whatsapp).request(
			await signedRequest(raw, 'app_secret_cedar'),
		);

		expect(response.status).toBe(200);
		expect(webhook).toHaveBeenCalledOnce();
		expect(webhook.mock.calls[0]?.[0]).toMatchObject({
			c: expect.any(Object),
			delivery: {
				object: 'whatsapp_business_account',
				raw,
				events: [
					{
						type: 'message',
						entryIndex: 0,
						changeIndex: 0,
						itemIndex: 0,
						businessAccountId: 'waba_8202',
						phoneNumberId: 'phone_9202',
						sender: {
							phoneNumber: '+15557001414',
							userId: 'user_amber_14',
							profileName: 'Amber Quill',
						},
						conversation: {
							type: 'individual',
							businessAccountId: 'waba_8202',
							phoneNumberId: 'phone_9202',
							recipientId: '+15557001414',
						},
						message: {
							kind: 'text',
							id: 'wamid_text_cedar',
							text: 'Please inspect the edge cache.',
							context: { forwarded: true },
						},
					},
					{
						type: 'message',
						itemIndex: 1,
						conversation: {
							type: 'group',
							groupId: 'group_ops_cedar',
						},
						message: {
							kind: 'interactive',
							reply: {
								type: 'list_reply',
								id: 'region_west',
								title: 'West region',
								description: 'Oregon and Washington',
							},
						},
					},
					{
						type: 'status',
						itemIndex: 0,
						status: {
							messageId: 'wamid_outbound_cedar',
							state: 'delivered',
							providerState: 'delivered',
							recipientId: '+15557001414',
							opaqueCallbackData: 'ticket_778',
							conversationId: 'conversation_cedar',
							conversationCategory: 'service',
							errors: [],
						},
					},
					{
						type: 'unknown',
						field: 'phone_number_quality_update',
						entryIndex: 0,
						changeIndex: 1,
					},
				],
			},
		});
	});

	it('normalizes media, location, contacts, reactions, revocations, and unsupported messages', async () => {
		const webhook = vi.fn();
		const whatsapp = createWhatsAppChannel({
			appSecret: 'app_secret_maple',
			verifyToken: 'verify_token_maple',
			businessAccountId: 'waba_8303',
			phoneNumberId: 'phone_9303',
			webhook,
		});
		const raw = {
			object: 'whatsapp_business_account',
			entry: [
				{
					id: 'waba_8303',
					changes: [
						{
							field: 'messages',
							value: {
								messaging_product: 'whatsapp',
								metadata: {
									display_phone_number: '+1 555 703 9303',
									phone_number_id: 'phone_9303',
								},
								messages: [
									{
										id: 'wamid_image_maple',
										from: '+15557033001',
										timestamp: '1781200201',
										type: 'image',
										image: {
											id: 'media_image_maple',
											mime_type: 'image/webp',
											sha256: 'synthetic-hash-maple',
											caption: 'Damaged package',
											url: 'https://media.invalid/private-maple',
										},
									},
									{
										id: 'wamid_location_maple',
										from: '+15557033001',
										timestamp: '1781200202',
										type: 'location',
										location: {
											latitude: 45.5231,
											longitude: -122.6765,
											name: 'Warehouse North',
											address: '88 River Lane',
										},
									},
									{
										id: 'wamid_contacts_maple',
										from: '+15557033001',
										timestamp: '1781200203',
										type: 'contacts',
										contacts: [
											{
												name: {
													formatted_name: 'Mira Stone',
													first_name: 'Mira',
													last_name: 'Stone',
												},
												phones: [
													{
														phone: '+15557039991',
														wa_id: 'user_mira_991',
														type: 'WORK',
													},
												],
												emails: [{ email: 'mira@example.test', type: 'WORK' }],
												org: { company: 'Northwind Repair' },
											},
										],
									},
									{
										id: 'wamid_reaction_maple',
										from: '+15557033001',
										timestamp: '1781200204',
										type: 'reaction',
										reaction: {
											message_id: 'wamid_target_maple',
											emoji: '✅',
										},
									},
									{
										id: 'wamid_reaction_removed_maple',
										from: '+15557033001',
										timestamp: '1781200205',
										type: 'reaction',
										reaction: { message_id: 'wamid_target_maple' },
									},
									{
										id: 'wamid_revoke_maple',
										from: '+15557033001',
										timestamp: '1781200206',
										type: 'revoke',
										revoke: { original_message_id: 'wamid_old_maple' },
									},
									{
										id: 'wamid_unsupported_maple',
										from: '+15557033001',
										timestamp: '1781200207',
										type: 'unsupported',
										unsupported: { type: 'poll_creation' },
										errors: [
											{
												code: 131051,
												title: 'Synthetic unsupported type',
												error_data: { details: 'Not exposed by this API version.' },
											},
										],
									},
									{
										id: 'wamid_future_maple',
										from: '+15557033001',
										timestamp: '1781200208',
										type: 'future_message',
										future_message: { value: 7 },
									},
								],
							},
						},
					],
				},
			],
		};

		const response = await channelApp(whatsapp).request(
			await signedRequest(raw, 'app_secret_maple'),
		);

		expect(response.status).toBe(200);
		const events = webhook.mock.calls[0]?.[0].delivery.events;
		expect(events).toHaveLength(8);
		expect(events[0].message).toEqual(
			expect.objectContaining({
				kind: 'media',
				media: {
					type: 'image',
					id: 'media_image_maple',
					mimeType: 'image/webp',
					sha256: 'synthetic-hash-maple',
					caption: 'Damaged package',
				},
			}),
		);
		expect(events[0].message.media).not.toHaveProperty('url');
		expect(events[1].message).toMatchObject({
			kind: 'location',
			location: {
				latitude: 45.5231,
				longitude: -122.6765,
				name: 'Warehouse North',
			},
		});
		expect(events[2].message).toMatchObject({
			kind: 'contacts',
			contacts: [
				{
					name: {
						formattedName: 'Mira Stone',
						firstName: 'Mira',
						lastName: 'Stone',
					},
					phones: [{ phone: '+15557039991', userId: 'user_mira_991', type: 'WORK' }],
					emails: [{ email: 'mira@example.test', type: 'WORK' }],
					organization: { company: 'Northwind Repair' },
				},
			],
		});
		expect(events[3].message).toMatchObject({
			kind: 'reaction',
			reaction: {
				messageId: 'wamid_target_maple',
				action: 'add',
				emoji: '✅',
			},
		});
		expect(events[4].message).toMatchObject({
			kind: 'reaction',
			reaction: { messageId: 'wamid_target_maple', action: 'remove' },
		});
		expect(events[5].message).toMatchObject({
			kind: 'revoke',
			originalMessageId: 'wamid_old_maple',
		});
		expect(events[6].message).toMatchObject({
			kind: 'unsupported',
			unsupportedType: 'poll_creation',
			errors: [{ code: 131051, details: 'Not exposed by this API version.' }],
		});
		expect(events[7].message).toMatchObject({
			kind: 'unknown',
			messageType: 'future_message',
		});
	});

	it('rejects changed bytes and mismatched fixed business identities', async () => {
		const webhook = vi.fn();
		const whatsapp = createWhatsAppChannel({
			appSecret: 'app_secret_onyx',
			verifyToken: 'verify_token_onyx',
			businessAccountId: 'waba_8404',
			phoneNumberId: 'phone_9404',
			webhook,
		});
		const body = ` {\n  "object":"whatsapp_business_account",\n  "entry":[{"id":"waba_8404","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"+1 555 704 9404","phone_number_id":"phone_9404"},"messages":[{"id":"wamid_unicode_onyx","from":"+15557044004","timestamp":"1781200301","type":"text","text":{"body":"Unicode café"}}]}}]}]\n} `;
		const signature = await hmac('app_secret_onyx', body);
		const app = channelApp(whatsapp);

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
				body: body.replace('café', 'cafe'),
			}),
		);
		const wrongAccount = await app.request(
			await signedRequest(
				{
					object: 'whatsapp_business_account',
					entry: [{ id: 'waba_other', changes: [] }],
				},
				'app_secret_onyx',
			),
		);
		const wrongPhone = await app.request(
			await signedRequest(
				{
					object: 'whatsapp_business_account',
					entry: [
						{
							id: 'waba_8404',
							changes: [
								{
									field: 'messages',
									value: {
										messaging_product: 'whatsapp',
										metadata: {
											display_phone_number: '+1 555 000 0000',
											phone_number_id: 'phone_other',
										},
										messages: [],
									},
								},
							],
						},
					],
				},
				'app_secret_onyx',
			),
		);

		expect(accepted.status).toBe(200);
		expect(changed.status).toBe(401);
		expect(wrongAccount.status).toBe(403);
		expect(wrongPhone.status).toBe(403);
		expect(webhook).toHaveBeenCalledOnce();
	});

	it('rejects malformed requests before invoking application code', async () => {
		const webhook = vi.fn();
		const whatsapp = createWhatsAppChannel({
			appSecret: 'app_secret_fir',
			verifyToken: 'verify_token_fir',
			businessAccountId: 'waba_8505',
			phoneNumberId: 'phone_9505',
			bodyLimit: 160,
			webhook,
		});
		const app = channelApp(whatsapp);

		const wrongContentType = await app.request(
			new Request('https://example.test/webhook', {
				method: 'POST',
				headers: {
					'content-type': 'text/plain',
					'x-hub-signature-256': `sha256=${'0'.repeat(64)}`,
				},
				body: '{}',
			}),
		);
		const missingSignature = await app.request(
			new Request('https://example.test/webhook', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{}',
			}),
		);
		const malformed = await app.request(await signedTextRequest('{"object":', 'app_secret_fir'));
		const oversized = await app.request(
			await signedTextRequest(`{"padding":"${'x'.repeat(200)}"}`, 'app_secret_fir'),
		);
		const malformedEnvelope = await app.request(
			await signedRequest(
				{ object: 'whatsapp_business_account', entry: [{ id: 'waba_8505' }] },
				'app_secret_fir',
			),
		);

		expect(wrongContentType.status).toBe(415);
		expect(missingSignature.status).toBe(401);
		expect(malformed.status).toBe(400);
		expect(oversized.status).toBe(413);
		expect(malformedEnvelope.status).toBe(400);
		expect(webhook).not.toHaveBeenCalled();
	});

	it('uses normal JSON and Hono response behavior', async () => {
		const raw = {
			object: 'whatsapp_business_account',
			entry: [],
		};
		const empty = createWhatsAppChannel({
			appSecret: 'app_secret_response',
			verifyToken: 'verify_token_response',
			businessAccountId: 'waba_8606',
			phoneNumberId: 'phone_9606',
			webhook() {},
		});
		const json = createWhatsAppChannel({
			appSecret: 'app_secret_response',
			verifyToken: 'verify_token_response',
			businessAccountId: 'waba_8606',
			phoneNumberId: 'phone_9606',
			webhook() {
				return { accepted: true };
			},
		});
		const hono = createWhatsAppChannel({
			appSecret: 'app_secret_response',
			verifyToken: 'verify_token_response',
			businessAccountId: 'waba_8606',
			phoneNumberId: 'phone_9606',
			webhook({ c }) {
				return c.json({ queued: true }, 202);
			},
		});
		const throws = createWhatsAppChannel({
			appSecret: 'app_secret_response',
			verifyToken: 'verify_token_response',
			businessAccountId: 'waba_8606',
			phoneNumberId: 'phone_9606',
			webhook() {
				throw new Error('synthetic handler failure');
			},
		});
		const invalid = createWhatsAppChannel({
			appSecret: 'app_secret_response',
			verifyToken: 'verify_token_response',
			businessAccountId: 'waba_8606',
			phoneNumberId: 'phone_9606',
			webhook() {
				const value: { self?: unknown } = {};
				value.self = value;
				return value as never;
			},
		});

		const emptyResponse = await channelApp(empty).request(
			await signedRequest(raw, 'app_secret_response'),
		);
		const jsonResponse = await channelApp(json).request(
			await signedRequest(raw, 'app_secret_response'),
		);
		const honoResponse = await channelApp(hono).request(
			await signedRequest(raw, 'app_secret_response'),
		);
		const thrownResponse = await channelApp(throws).request(
			await signedRequest(raw, 'app_secret_response'),
		);
		const invalidResponse = await channelApp(invalid).request(
			await signedRequest(raw, 'app_secret_response'),
		);

		expect(emptyResponse.status).toBe(200);
		expect(await emptyResponse.text()).toBe('');
		expect(jsonResponse.status).toBe(200);
		expect(await jsonResponse.json()).toEqual({ accepted: true });
		expect(honoResponse.status).toBe(202);
		expect(await honoResponse.json()).toEqual({ queued: true });
		expect(thrownResponse.status).toBe(500);
		expect(invalidResponse.status).toBe(500);
	});

	it('round-trips canonical individual and group conversation keys', () => {
		const whatsapp = createWhatsAppChannel({
			appSecret: 'app_secret_keys',
			verifyToken: 'verify_token_keys',
			businessAccountId: 'waba:with/slash',
			phoneNumberId: 'phone number 77',
			webhook() {},
		});
		const individual: WhatsAppConversationRef = {
			type: 'individual',
			businessAccountId: 'waba:with/slash',
			phoneNumberId: 'phone number 77',
			recipientId: '+15557007777',
		};
		const group: WhatsAppConversationRef = {
			type: 'group',
			businessAccountId: 'waba:with/slash',
			phoneNumberId: 'phone number 77',
			groupId: 'group:west/7',
		};

		const individualKey = whatsapp.conversationKey(individual);
		const groupKey = whatsapp.conversationKey(group);

		expect(whatsapp.parseConversationKey(individualKey)).toEqual(individual);
		expect(whatsapp.parseConversationKey(groupKey)).toEqual(group);
		expect(() => whatsapp.parseConversationKey(`${individualKey}%2f`)).toThrow(
			InvalidWhatsAppConversationKeyError,
		);
		expect(() =>
			whatsapp.conversationKey({
				...individual,
				recipientId: ' spaced ',
			}),
		).toThrow(InvalidWhatsAppInputError);
	});

	it('validates constructor options without invoking the handler', () => {
		const webhook = vi.fn();

		expect(() =>
			createWhatsAppChannel({
				appSecret: '',
				verifyToken: 'token',
				businessAccountId: 'waba',
				phoneNumberId: 'phone',
				webhook,
			}),
		).toThrow(InvalidWhatsAppInputError);
		expect(() =>
			createWhatsAppChannel({
				appSecret: 'secret',
				verifyToken: 'token',
				businessAccountId: 'waba',
				phoneNumberId: 'phone',
				bodyLimit: 0,
				webhook,
			}),
		).toThrow(TypeError);
		expect(webhook).not.toHaveBeenCalled();
	});
});

function channelApp(channel: WhatsAppChannel): Hono {
	const app = new Hono();
	for (const route of channel.routes) {
		app.on(route.method, route.path, route.handler);
	}
	return app;
}

async function signedRequest(value: unknown, secret: string): Promise<Request> {
	return signedTextRequest(JSON.stringify(value), secret);
}

async function signedTextRequest(body: string, secret: string): Promise<Request> {
	const signature = await hmac(secret, body);
	return new Request('https://example.test/webhook', {
		method: 'POST',
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'x-hub-signature-256': `sha256=${signature}`,
		},
		body,
	});
}

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
