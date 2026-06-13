import type { Context, Env, Handler } from 'hono';
import { InvalidWhatsAppConversationKeyError, InvalidWhatsAppInputError } from './errors.ts';
import { createWhatsAppVerificationHandler, createWhatsAppWebhookHandler } from './webhook.ts';

export { InvalidWhatsAppConversationKeyError, InvalidWhatsAppInputError } from './errors.ts';

export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

export interface ChannelRoute<E extends Env = Env> {
	readonly method: string;
	readonly path: string;
	readonly handler: Handler<E>;
}

/** Ingress configuration for one fixed WhatsApp business phone number. */
export interface WhatsAppChannelOptions<E extends Env = Env> {
	/** Meta app secret used to verify exact POST request bytes. */
	appSecret: string;
	/** User-chosen token configured for Meta's GET verification handshake. */
	verifyToken: string;
	/** Expected WhatsApp Business Account id from every delivery. */
	businessAccountId: string;
	/** Expected business phone-number id from every `messages` change. */
	phoneNumberId: string;
	/** Maximum POST body size in bytes. Defaults to 3 * 1024 * 1024. */
	bodyLimit?: number;
	/** Receives one verified delivery with all batched events preserved. */
	webhook(input: WhatsAppWebhookHandlerInput<E>): WhatsAppHandlerResult;
}

/** Stable WhatsApp destination suitable for a Flue agent-instance id. */
export type WhatsAppConversationRef =
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

export interface WhatsAppUserRef {
	/** Phone number supplied by the message `from` field. */
	phoneNumber: string;
	/** WhatsApp user id when Meta supplies a matching contact record. */
	userId?: string;
	profileName?: string;
}

export interface WhatsAppMessageContext {
	messageId?: string;
	from?: string;
	forwarded?: boolean;
	frequentlyForwarded?: boolean;
}

export interface WhatsAppReferral {
	sourceType?: string;
	sourceId?: string;
	sourceUrl?: string;
	body?: string;
	headline?: string;
	mediaType?: string;
}

export interface WhatsAppMedia {
	type: 'audio' | 'document' | 'image' | 'sticker' | 'video';
	id: string;
	mimeType?: string;
	sha256?: string;
	caption?: string;
	filename?: string;
	voice?: boolean;
}

export interface WhatsAppSharedContact {
	name: {
		formattedName: string;
		firstName?: string;
		lastName?: string;
		middleName?: string;
		prefix?: string;
		suffix?: string;
	};
	birthday?: string;
	phones: readonly {
		phone?: string;
		userId?: string;
		type?: string;
	}[];
	emails: readonly {
		email: string;
		type?: string;
	}[];
	organization?: {
		company?: string;
		department?: string;
		title?: string;
	};
	addresses: readonly {
		street?: string;
		city?: string;
		state?: string;
		zip?: string;
		country?: string;
		countryCode?: string;
		type?: string;
	}[];
	urls: readonly {
		url: string;
		type?: string;
	}[];
}

interface WhatsAppMessageBase {
	id: string;
	from: string;
	timestamp: number;
	groupId?: string;
	context?: WhatsAppMessageContext;
	referral?: WhatsAppReferral;
}

export type WhatsAppMessage =
	| (WhatsAppMessageBase & {
			kind: 'text';
			text: string;
	  })
	| (WhatsAppMessageBase & {
			kind: 'media';
			media: WhatsAppMedia;
	  })
	| (WhatsAppMessageBase & {
			kind: 'location';
			location: {
				latitude: number;
				longitude: number;
				name?: string;
				address?: string;
				url?: string;
			};
	  })
	| (WhatsAppMessageBase & {
			kind: 'contacts';
			contacts: readonly WhatsAppSharedContact[];
	  })
	| (WhatsAppMessageBase & {
			kind: 'interactive';
			reply: {
				type: 'button_reply' | 'list_reply';
				id: string;
				title: string;
				description?: string;
			};
	  })
	| (WhatsAppMessageBase & {
			kind: 'button';
			button: { payload: string; text: string };
	  })
	| (WhatsAppMessageBase & {
			kind: 'reaction';
			reaction: {
				messageId: string;
				action: 'add' | 'remove';
				emoji?: string;
			};
	  })
	| (WhatsAppMessageBase & {
			kind: 'revoke';
			originalMessageId: string;
	  })
	| (WhatsAppMessageBase & {
			kind: 'unsupported';
			unsupportedType?: string;
			errors: readonly WhatsAppErrorRef[];
	  })
	| (WhatsAppMessageBase & {
			kind: 'unknown';
			messageType: string;
	  });

export interface WhatsAppErrorRef {
	code: number;
	title?: string;
	message?: string;
	details?: string;
	href?: string;
}

interface WhatsAppEventPosition {
	businessAccountId: string;
	phoneNumberId?: string;
	displayPhoneNumber?: string;
	entryIndex: number;
	changeIndex: number;
	itemIndex: number;
	/** Provider object for this event after exact-body verification. */
	raw: unknown;
}

export interface WhatsAppMessageEvent extends WhatsAppEventPosition {
	type: 'message';
	sender: WhatsAppUserRef;
	message: WhatsAppMessage;
	conversation: WhatsAppConversationRef;
}

export interface WhatsAppStatusEvent extends WhatsAppEventPosition {
	type: 'status';
	status: {
		messageId: string;
		state: 'delivered' | 'failed' | 'played' | 'read' | 'sent' | 'unknown';
		providerState: string;
		timestamp: number;
		recipientId: string;
		recipientParticipantId?: string;
		opaqueCallbackData?: string;
		conversationId?: string;
		conversationCategory?: string;
		errors: readonly WhatsAppErrorRef[];
	};
	conversation: WhatsAppConversationRef;
}

export interface WhatsAppUnknownEvent extends Omit<WhatsAppEventPosition, 'itemIndex'> {
	type: 'unknown';
	field: string;
}

export type WhatsAppWebhookEvent =
	| WhatsAppMessageEvent
	| WhatsAppStatusEvent
	| WhatsAppUnknownEvent;

export interface WhatsAppWebhookDelivery {
	object: 'whatsapp_business_account';
	/** Events remain in entry, change, and item order from the signed payload. */
	events: readonly WhatsAppWebhookEvent[];
	/** Complete parsed payload after exact-body verification and identity checks. */
	raw: unknown;
}

type WhatsAppHandlerValue = undefined | JsonValue | Response;

export type WhatsAppHandlerResult = WhatsAppHandlerValue | Promise<WhatsAppHandlerValue>;

export interface WhatsAppWebhookHandlerInput<E extends Env = Env> {
	c: Context<E>;
	delivery: WhatsAppWebhookDelivery;
}

/** Verified WhatsApp ingress and canonical destination identity helpers. */
export interface WhatsAppChannel<E extends Env = Env> {
	readonly routes: readonly ChannelRoute<E>[];
	/** Serializes a canonical namespaced identifier. It is not an authorization capability. */
	conversationKey(ref: WhatsAppConversationRef): string;
	/** Parses only canonical keys produced by `conversationKey()`. */
	parseConversationKey(id: string): WhatsAppConversationRef;
}

/**
 * Creates GET verification and POST delivery routes for one fixed WhatsApp
 * business phone number.
 *
 * The channel is stateless and does not deduplicate message ids or retries.
 */
export function createWhatsAppChannel<E extends Env = Env>(
	options: WhatsAppChannelOptions<E>,
): WhatsAppChannel<E> {
	validateOptions(options);
	const channel: WhatsAppChannel<E> = {
		routes: [
			{
				method: 'GET',
				path: '/webhook',
				handler: createWhatsAppVerificationHandler(options),
			},
			{
				method: 'POST',
				path: '/webhook',
				handler: createWhatsAppWebhookHandler(options),
			},
		],
		conversationKey(ref) {
			assertConversationRef(ref);
			const base = [
				'whatsapp',
				'v1',
				'business-account',
				encodeURIComponent(ref.businessAccountId),
				'phone-number',
				encodeURIComponent(ref.phoneNumberId),
			];
			return ref.type === 'group'
				? [...base, 'group', encodeURIComponent(ref.groupId)].join(':')
				: [...base, 'individual', encodeURIComponent(ref.recipientId)].join(':');
		},
		parseConversationKey(id) {
			try {
				const match =
					/^whatsapp:v1:business-account:([^:]+):phone-number:([^:]+):(individual|group):([^:]+)$/.exec(
						id,
					);
				if (!match) throw new InvalidWhatsAppConversationKeyError();
				const [, businessAccountId, phoneNumberId, type, destination] = match;
				if (!businessAccountId || !phoneNumberId || !type || !destination) {
					throw new InvalidWhatsAppConversationKeyError();
				}
				const common = {
					businessAccountId: decodeURIComponent(businessAccountId),
					phoneNumberId: decodeURIComponent(phoneNumberId),
				};
				const ref: WhatsAppConversationRef =
					type === 'group'
						? { type, ...common, groupId: decodeURIComponent(destination) }
						: {
								type: 'individual',
								...common,
								recipientId: decodeURIComponent(destination),
							};
				assertConversationRef(ref);
				if (channel.conversationKey(ref) !== id) {
					throw new InvalidWhatsAppConversationKeyError();
				}
				return ref;
			} catch (error) {
				if (error instanceof InvalidWhatsAppConversationKeyError) throw error;
				throw new InvalidWhatsAppConversationKeyError();
			}
		},
	};
	return channel;
}

function validateOptions<E extends Env>(options: WhatsAppChannelOptions<E>): void {
	if (!options || typeof options !== 'object') {
		throw new TypeError('createWhatsAppChannel() requires an options object.');
	}
	for (const field of ['appSecret', 'verifyToken', 'businessAccountId', 'phoneNumberId'] as const) {
		if (typeof options[field] !== 'string' || options[field].length === 0) {
			throw new InvalidWhatsAppInputError(field);
		}
	}
	if (typeof options.webhook !== 'function') {
		throw new InvalidWhatsAppInputError('webhook');
	}
}

function assertConversationRef(ref: WhatsAppConversationRef): void {
	if (!ref || typeof ref !== 'object') throw new InvalidWhatsAppInputError('ref');
	assertSegment(ref.businessAccountId, 'conversation.businessAccountId');
	assertSegment(ref.phoneNumberId, 'conversation.phoneNumberId');
	if (ref.type === 'individual') {
		assertSegment(ref.recipientId, 'conversation.recipientId');
		return;
	}
	if (ref.type === 'group') {
		assertSegment(ref.groupId, 'conversation.groupId');
		return;
	}
	throw new InvalidWhatsAppInputError('conversation.type');
}

function assertSegment(value: unknown, field: string): asserts value is string {
	if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
		throw new InvalidWhatsAppInputError(field);
	}
}
