import type { Context, Env, Handler } from 'hono';
import type { Resend, WebhookEventPayload } from 'resend';
import { createResendWebhookHandler } from './webhook.ts';

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

export interface ResendChannelOptions<E extends Env = Env> {
	/** Project-owned official Resend client used for webhook verification. */
	client: Resend;
	/** Signing secret for this Resend webhook endpoint. */
	webhookSecret: string;
	/** Maximum request-body size in bytes. Defaults to 1 MiB. */
	bodyLimit?: number;
	/** Receives every verified Resend webhook delivery. */
	webhook(input: ResendWebhookHandlerInput<E>): ResendHandlerResult;
}

/** Provider event names whose payload shapes are validated by this package. */
export type ResendKnownEventType =
	| 'email.sent'
	| 'email.scheduled'
	| 'email.delivered'
	| 'email.delivery_delayed'
	| 'email.complained'
	| 'email.bounced'
	| 'email.opened'
	| 'email.clicked'
	| 'email.received'
	| 'email.failed'
	| 'email.suppressed'
	| 'contact.created'
	| 'contact.updated'
	| 'contact.deleted'
	| 'domain.created'
	| 'domain.updated'
	| 'domain.deleted';

/** Official SDK event variants whose payload shapes are validated by this package. */
export type ResendKnownWebhookEvent = Extract<WebhookEventPayload, { type: ResendKnownEventType }>;

/** Verified provider event whose type is not in `ResendKnownEventType`. */
export interface ResendUnknownWebhookEvent {
	type: 'unknown';
	eventType: string;
	createdAt: string;
	data: Record<string, unknown>;
	/** Complete parsed payload after signature verification. */
	raw: unknown;
}

export type ResendWebhookEvent = ResendKnownWebhookEvent | ResendUnknownWebhookEvent;

export interface ResendWebhookDelivery {
	/** `svix-id`; use this for application-owned deduplication. */
	id: string;
	/** Signed Unix timestamp from `svix-timestamp`. */
	timestamp: string;
}

/** Input passed to the application after authentication and event validation. */
export interface ResendWebhookHandlerInput<E extends Env = Env> {
	c: Context<E>;
	event: ResendWebhookEvent;
	delivery: ResendWebhookDelivery;
}

type ResendHandlerValue = undefined | JsonValue | Response;

/**
 * Returning no value or JSON acknowledges with `200`. A returned `Response`
 * passes through; Resend retries any status other than `200`.
 */
export type ResendHandlerResult = ResendHandlerValue | Promise<ResendHandlerValue>;

/** Verified Resend ingress. */
export interface ResendChannel<E extends Env = Env> {
	readonly routes: readonly ChannelRoute<E>[];
}

/**
 * Creates one verified Resend webhook route.
 *
 * The route is fixed at `POST /webhook`. The channel is stateless and does not
 * deduplicate or reorder deliveries.
 */
export function createResendChannel<E extends Env = Env>(
	options: ResendChannelOptions<E>,
): ResendChannel<E> {
	validateOptions(options);
	return {
		routes: [
			{
				method: 'POST',
				path: '/webhook',
				handler: createResendWebhookHandler(options),
			},
		],
	};
}

function validateOptions<E extends Env>(options: ResendChannelOptions<E>): void {
	if (!options || typeof options !== 'object') {
		throw new TypeError('createResendChannel() requires an options object.');
	}
	if (!isResendClient(options.client)) {
		throw new TypeError('createResendChannel() requires a Resend client.');
	}
	if (typeof options.webhookSecret !== 'string' || options.webhookSecret.length === 0) {
		throw new TypeError('createResendChannel() requires a non-empty webhookSecret.');
	}
	if (typeof options.webhook !== 'function') {
		throw new TypeError('createResendChannel() requires a webhook handler.');
	}
}

function isResendClient(value: unknown): value is Resend {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as { webhooks?: { verify?: unknown } };
	return typeof candidate.webhooks?.verify === 'function';
}
