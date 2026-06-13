import type { Env, Handler } from 'hono';
import type {
	JsonValue,
	ResendChannelOptions,
	ResendHandlerResult,
	ResendKnownEventType,
	ResendKnownWebhookEvent,
	ResendUnknownWebhookEvent,
	ResendWebhookDelivery,
	ResendWebhookEvent,
} from './index.ts';

const DEFAULT_BODY_LIMIT = 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });

const KNOWN_EVENT_TYPES = new Set<ResendKnownEventType>([
	'email.sent',
	'email.scheduled',
	'email.delivered',
	'email.delivery_delayed',
	'email.complained',
	'email.bounced',
	'email.opened',
	'email.clicked',
	'email.received',
	'email.failed',
	'email.suppressed',
	'contact.created',
	'contact.updated',
	'contact.deleted',
	'domain.created',
	'domain.updated',
	'domain.deleted',
]);

export function createResendWebhookHandler<E extends Env>(
	options: ResendChannelOptions<E>,
): Handler<E> {
	const bodyLimit = options.bodyLimit ?? DEFAULT_BODY_LIMIT;
	if (!Number.isSafeInteger(bodyLimit) || bodyLimit <= 0) {
		throw new TypeError('Resend webhook bodyLimit must be a positive integer.');
	}

	return async (c) => {
		const request = c.req.raw;
		if (!isJsonRequest(request)) return response(415);
		const contentLength = request.headers.get('content-length');
		if (contentLength !== null && !/^\d+$/.test(contentLength)) return response(400);
		if (contentLength !== null && Number(contentLength) > bodyLimit) return response(413);

		const delivery = readDelivery(request.headers);
		const signature = request.headers.get('svix-signature');
		if (!delivery || !signature) return response(400);

		const body = await readBody(request, bodyLimit);
		if (body.type === 'too-large') return response(413);
		if (body.type === 'invalid') return response(400);

		let payload: string;
		try {
			payload = decoder.decode(body.value);
		} catch {
			return response(400);
		}

		let raw: unknown;
		try {
			raw = options.client.webhooks.verify({
				payload,
				headers: {
					id: delivery.id,
					timestamp: delivery.timestamp,
					signature,
				},
				webhookSecret: options.webhookSecret,
			});
		} catch {
			return response(400);
		}

		const event = normalizeEvent(raw);
		if (!event) return response(400);
		return runHandler(() => options.webhook({ c, event, delivery }));
	};
}

function readDelivery(headers: Headers): ResendWebhookDelivery | undefined {
	const id = headers.get('svix-id');
	const timestamp = headers.get('svix-timestamp');
	if (!id || !timestamp || !/^\d+$/.test(timestamp)) return undefined;
	const seconds = Number(timestamp);
	if (!Number.isSafeInteger(seconds) || seconds <= 0) return undefined;
	return { id, timestamp };
}

function normalizeEvent(raw: unknown): ResendWebhookEvent | undefined {
	if (!isRecord(raw)) return undefined;
	const eventType = readNonEmptyString(raw, 'type');
	const createdAt = readIsoTimestamp(raw, 'created_at');
	if (!eventType || !createdAt || !isRecord(raw.data)) return undefined;

	if (isKnownEventType(eventType)) {
		if (!isKnownEventPayload(eventType, raw.data)) return undefined;
		return raw as unknown as ResendKnownWebhookEvent;
	}
	return {
		type: 'unknown',
		eventType,
		createdAt,
		data: raw.data,
		raw,
	} satisfies ResendUnknownWebhookEvent;
}

function isKnownEventType(value: string): value is ResendKnownEventType {
	return KNOWN_EVENT_TYPES.has(value as ResendKnownEventType);
}

function isKnownEventPayload(eventType: string, data: Record<string, unknown>): boolean {
	if (eventType.startsWith('contact.')) return isContactEventData(data);
	if (eventType.startsWith('domain.')) return isDomainEventData(data);
	if (eventType === 'email.received') return isReceivedEmailEventData(data);
	if (!isBaseEmailEventData(data)) return false;

	switch (eventType) {
		case 'email.bounced':
			return isStringRecord(data.bounce, ['message', 'subType', 'type']);
		case 'email.clicked':
			return isStringRecord(data.click, ['ipAddress', 'link', 'timestamp', 'userAgent']);
		case 'email.failed':
			return isStringRecord(data.failed, ['reason']);
		case 'email.suppressed':
			return isStringRecord(data.suppressed, ['message', 'type']);
		default:
			return true;
	}
}

function isBaseEmailEventData(data: Record<string, unknown>): boolean {
	return (
		readIsoTimestamp(data, 'created_at') !== undefined &&
		readNonEmptyString(data, 'email_id') !== undefined &&
		readNonEmptyString(data, 'from') !== undefined &&
		isStringArray(data.to) &&
		readString(data, 'subject') !== undefined &&
		isOptionalString(data.broadcast_id) &&
		isOptionalString(data.template_id) &&
		isOptionalStringMap(data.tags)
	);
}

function isReceivedEmailEventData(data: Record<string, unknown>): boolean {
	return (
		readNonEmptyString(data, 'email_id') !== undefined &&
		readIsoTimestamp(data, 'created_at') !== undefined &&
		readNonEmptyString(data, 'from') !== undefined &&
		isStringArray(data.to) &&
		isStringArray(data.bcc) &&
		isStringArray(data.cc) &&
		readNonEmptyString(data, 'message_id') !== undefined &&
		readString(data, 'subject') !== undefined &&
		Array.isArray(data.attachments) &&
		data.attachments.every(isReceivedAttachment)
	);
}

function isReceivedAttachment(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return (
		readNonEmptyString(value, 'id') !== undefined &&
		(value.filename === null || typeof value.filename === 'string') &&
		readNonEmptyString(value, 'content_type') !== undefined &&
		(value.content_disposition === null || typeof value.content_disposition === 'string') &&
		(value.content_id === null || typeof value.content_id === 'string')
	);
}

function isContactEventData(data: Record<string, unknown>): boolean {
	return (
		readNonEmptyString(data, 'id') !== undefined &&
		readNonEmptyString(data, 'audience_id') !== undefined &&
		isStringArray(data.segment_ids) &&
		readIsoTimestamp(data, 'created_at') !== undefined &&
		readIsoTimestamp(data, 'updated_at') !== undefined &&
		readNonEmptyString(data, 'email') !== undefined &&
		isOptionalString(data.first_name) &&
		isOptionalString(data.last_name) &&
		typeof data.unsubscribed === 'boolean'
	);
}

function isDomainEventData(data: Record<string, unknown>): boolean {
	return (
		readNonEmptyString(data, 'id') !== undefined &&
		readNonEmptyString(data, 'name') !== undefined &&
		readNonEmptyString(data, 'status') !== undefined &&
		readIsoTimestamp(data, 'created_at') !== undefined &&
		readNonEmptyString(data, 'region') !== undefined &&
		Array.isArray(data.records) &&
		data.records.every(isDomainRecord)
	);
}

function isDomainRecord(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return (
		readNonEmptyString(value, 'record') !== undefined &&
		readNonEmptyString(value, 'name') !== undefined &&
		readNonEmptyString(value, 'type') !== undefined &&
		readString(value, 'ttl') !== undefined &&
		readNonEmptyString(value, 'status') !== undefined &&
		readString(value, 'value') !== undefined &&
		(value.priority === undefined ||
			(typeof value.priority === 'number' && Number.isFinite(value.priority)))
	);
}

async function runHandler(handler: () => ResendHandlerResult): Promise<Response> {
	try {
		return serializeHandlerResult(await handler());
	} catch {
		return response(500);
	}
}

function serializeHandlerResult(value: unknown): Response {
	if (value instanceof Response) return value;
	if (value === undefined) return response(200);
	if (!isJsonValue(value)) return response(500);
	return Response.json(value);
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (typeof value !== 'object') return false;
	if (seen.has(value)) return false;
	if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return false;
	seen.add(value);
	try {
		return Array.isArray(value)
			? value.every((item) => isJsonValue(item, seen))
			: Object.values(value).every((item) => isJsonValue(item, seen));
	} finally {
		seen.delete(value);
	}
}

function isJsonRequest(request: Request): boolean {
	return (
		request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ===
		'application/json'
	);
}

async function readBody(
	request: Request,
	bodyLimit: number,
): Promise<{ type: 'success'; value: Uint8Array } | { type: 'too-large' } | { type: 'invalid' }> {
	if (!request.body) return { type: 'success', value: new Uint8Array() };
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > bodyLimit) {
				void reader.cancel();
				return { type: 'too-large' };
			}
			chunks.push(value);
		}
	} catch {
		return { type: 'invalid' };
	} finally {
		reader.releaseLock();
	}
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { type: 'success', value: body };
}

function isStringRecord(value: unknown, fields: string[]): boolean {
	if (!isRecord(value)) return false;
	return fields.every((field) => readNonEmptyString(value, field) !== undefined);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isOptionalString(value: unknown): boolean {
	return value === undefined || typeof value === 'string';
}

function isOptionalStringMap(value: unknown): boolean {
	return (
		value === undefined ||
		(isRecord(value) && Object.values(value).every((item) => typeof item === 'string'))
	);
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
	return typeof value[key] === 'string' ? value[key] : undefined;
}

function readNonEmptyString(value: Record<string, unknown>, key: string): string | undefined {
	const result = readString(value, key);
	return result && result.length > 0 ? result : undefined;
}

function readIsoTimestamp(value: Record<string, unknown>, key: string): string | undefined {
	const result = readNonEmptyString(value, key);
	return result && Number.isFinite(Date.parse(result)) ? result : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function response(status: number): Response {
	return new Response(null, { status });
}
