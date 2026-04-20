import { Resource, tables } from 'harper';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { classifyMessage } from './memory.js';
import { EMBEDDING_MODEL, generateEmbedding, log } from './shared.js';

const { Memory } = tables;

// ---------------------------------------------------------------------------
// Helper: Verify Slack request signature (HMAC-SHA256)
// NOTE: Not currently called — Harper Resource classes don't expose HTTP
// headers. Retained for future use when Harper adds header access.
// See verifyBodyToken below for the active verification mechanism.
// ---------------------------------------------------------------------------

export function verifySlackSignature(signingSecret, signature, timestamp, body) {
	if (!signingSecret || !signature || !timestamp || !body) {
		return false;
	}

	// Reject requests older than 5 minutes to prevent replay attacks
	const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
	if (parseInt(timestamp, 10) < fiveMinutesAgo) {
		return false;
	}

	const sigBasestring = `v0:${timestamp}:${body}`;
	const expectedSignature = 'v0=' + createHmac('sha256', signingSecret).update(sigBasestring).digest('hex');

	try {
		return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Helper: Verify Slack body-level verification token
// Harper Resource classes don't expose HTTP headers, so we verify using
// the legacy Verification Token that Slack includes in every event body
// (Slack app > Basic Information > App Credentials > Verification Token).
// ---------------------------------------------------------------------------

function verifyBodyToken(dataToken) {
	const expected = process.env.SLACK_VERIFICATION_TOKEN;
	if (!expected) {
		log('warn', 'SLACK_VERIFICATION_TOKEN not set — webhook requests are unauthenticated');
		return true;
	}
	if (!dataToken || typeof dataToken !== 'string') { return false; }
	try {
		return timingSafeEqual(Buffer.from(dataToken), Buffer.from(expected));
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// SlackWebhook - Receives Slack Events API POST requests
// ---------------------------------------------------------------------------

export class SlackWebhook extends Resource {
	async post(data) {
		if (!verifyBodyToken(data?.token)) {
			log('warn', 'Rejected webhook: invalid verification token');
			// Note: Harper Resources always return HTTP 200 — the status field here
			// is application-level only. The payload is still rejected (not processed).
			return { status: 401, message: 'unauthorized' };
		}

		// Handle Slack URL verification challenge
		if (data?.type === 'url_verification') {
			log('info', 'Slack URL verification challenge received');
			return { challenge: data.challenge };
		}

		// Ignore non-event callbacks
		if (data?.type !== 'event_callback') {
			return { status: 200, message: 'ignored' };
		}

		// Reject Slack retries to prevent duplicate processing
		// Slack sends X-Slack-Retry-Num header on retries, but in Harper
		// custom resources we check the event_id for deduplication
		const event = data.event;
		if (!event) {
			log('warn', 'Event callback received without event payload');
			return { status: 200, message: 'no_event' };
		}

		// Filter: only process human messages (skip bots, subtypes)
		if (event.type !== 'message' || event.subtype || event.bot_id) {
			return { status: 200, message: 'skipped' };
		}

		// Filter: skip empty messages
		if (!event.text || event.text.trim().length === 0) {
			return { status: 200, message: 'empty' };
		}

		// Return 200 immediately and process async to avoid Slack's 3s timeout
		const eventData = { ...data };
		setTimeout(() =>
			this._processMessage(eventData).catch((err) => {
				log('error', 'Async message processing failed', {
					error: err.message,
					eventId: eventData.event_id,
				});
			}), 0);

		return { status: 200, message: 'accepted' };
	}

	async _processMessage(data, agentId) {
		const event = data.event;

		log('info', 'Processing Slack message', {
			channel: event.channel,
			user: event.user,
			eventId: data.event_id,
			agentId,
		});

		// Check for duplicate event_id to prevent re-processing
		const existingMemories = [];
		for await (
			const record of Memory.search({
				conditions: { attribute: 'metadata', value: data.event_id },
				limit: 1,
			})
		) {
			existingMemories.push(record);
		}
		if (existingMemories.length > 0) {
			log('info', 'Duplicate event skipped', { eventId: data.event_id });
			return;
		}

		// Classify and embed in parallel
		const [classification, embedding] = await Promise.all([
			classifyMessage(event.text),
			generateEmbedding(event.text),
		]);

		const memoryRecord = {
			rawText: event.text,
			source: 'slack',
			sourceType: event.thread_ts ? 'thread_reply' : 'message',
			channelId: event.channel,
			channelName: event.channel_name || '',
			authorId: event.user,
			authorName: '',
			agentId: agentId || null,
			classification: classification.category,
			entities: classification.entities,
			embedding,
			summary: classification.summary,
			timestamp: new Date(parseFloat(event.ts) * 1000),
			threadTs: event.thread_ts || event.ts,
			metadata: {
				team_id: data.team_id,
				event_id: data.event_id,
				event_ts: event.ts,
				embedding_model: EMBEDDING_MODEL,
			},
		};

		await Memory.put(memoryRecord);

		log('info', 'Memory stored', {
			classification: classification.category,
			channel: event.channel,
			eventId: data.event_id,
		});
	}
}
