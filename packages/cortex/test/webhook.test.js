import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it, vi } from 'vitest';

const { MockMemory, MockSynapseEntry } = vi.hoisted(() => {
	class MockMemory {
		static put = vi.fn();
		static search = vi.fn(function*() {});
		static get = vi.fn();
	}
	class MockSynapseEntry {
		static put = vi.fn();
		static search = vi.fn(function*() {});
		static get = vi.fn();
	}
	return { MockMemory, MockSynapseEntry };
});

vi.mock('harper', () => ({
	Resource: class Resource {},
	tables: { Memory: MockMemory, SynapseEntry: MockSynapseEntry },
	default: { transaction: async (cb) => cb() },
}));

vi.mock('@anthropic-ai/sdk', () => ({
	default: class Anthropic {
		constructor() {
			this.messages = {
				create: vi.fn(async () => ({
					content: [{
						text: JSON.stringify({
							category: 'discussion',
							entities: { people: [], projects: [], technologies: [], topics: [], dates: [] },
							summary: 'test',
						}),
					}],
				})),
			};
		}
	},
}));

vi.mock('@huggingface/transformers', () => ({
	pipeline: vi.fn(async () => async () => ({ data: new Float32Array(384).fill(0.1) })),
}));

process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.SLACK_VERIFICATION_TOKEN = 'test-token';

const { verifySlackSignature, SlackWebhook } = await import('../resources.js');

describe('verifySlackSignature', () => {
	const signingSecret = 'test_signing_secret_12345';

	function createValidSignature(body, timestamp) {
		const sigBasestring = `v0:${timestamp}:${body}`;
		return 'v0=' + createHmac('sha256', signingSecret).update(sigBasestring).digest('hex');
	}

	it('returns true for a valid signature', () => {
		const timestamp = Math.floor(Date.now() / 1000).toString();
		const body = '{"type":"event_callback"}';
		const signature = createValidSignature(body, timestamp);

		assert.equal(verifySlackSignature(signingSecret, signature, timestamp, body), true);
	});

	it('returns false for an invalid signature', () => {
		const timestamp = Math.floor(Date.now() / 1000).toString();
		const body = '{"type":"event_callback"}';

		assert.equal(verifySlackSignature(signingSecret, 'v0=invalid', timestamp, body), false);
	});

	it('returns false for an expired timestamp (replay attack)', () => {
		const oldTimestamp = (Math.floor(Date.now() / 1000) - 600).toString();
		const body = '{"type":"event_callback"}';
		const signature = createValidSignature(body, oldTimestamp);

		assert.equal(verifySlackSignature(signingSecret, signature, oldTimestamp, body), false);
	});

	it('returns false for missing parameters', () => {
		assert.equal(verifySlackSignature(null, 'sig', '123', 'body'), false);
		assert.equal(verifySlackSignature(signingSecret, null, '123', 'body'), false);
		assert.equal(verifySlackSignature(signingSecret, 'sig', null, 'body'), false);
		assert.equal(verifySlackSignature(signingSecret, 'sig', '123', null), false);
	});

	it('returns false for tampered body', () => {
		const timestamp = Math.floor(Date.now() / 1000).toString();
		const originalBody = '{"type":"event_callback"}';
		const signature = createValidSignature(originalBody, timestamp);

		assert.equal(verifySlackSignature(signingSecret, signature, timestamp, '{"type":"tampered"}'), false);
	});
});

describe('SlackWebhook', () => {
	it('handles URL verification challenge', async () => {
		const webhook = new SlackWebhook();
		const result = await webhook.post({
			token: 'test-token',
			type: 'url_verification',
			challenge: 'test_challenge_token',
		});

		assert.equal(result.challenge, 'test_challenge_token');
	});

	it('ignores non-event_callback types', async () => {
		const webhook = new SlackWebhook();
		const result = await webhook.post({ token: 'test-token', type: 'app_rate_limited' });

		assert.equal(result.message, 'ignored');
	});

	it('skips bot messages', async () => {
		const webhook = new SlackWebhook();
		const result = await webhook.post({
			token: 'test-token',
			type: 'event_callback',
			event: { type: 'message', bot_id: 'B123', text: 'bot message', ts: '123.456' },
		});

		assert.equal(result.message, 'skipped');
	});

	it('skips message subtypes (joins, leaves, etc)', async () => {
		const webhook = new SlackWebhook();
		const result = await webhook.post({
			token: 'test-token',
			type: 'event_callback',
			event: { type: 'message', subtype: 'channel_join', text: 'joined', ts: '123.456' },
		});

		assert.equal(result.message, 'skipped');
	});

	it('skips empty messages', async () => {
		const webhook = new SlackWebhook();
		const result = await webhook.post({
			token: 'test-token',
			type: 'event_callback',
			event: { type: 'message', text: '', user: 'U123', ts: '123.456' },
		});

		assert.equal(result.message, 'empty');
	});

	it('accepts valid human messages for async processing', async () => {
		const webhook = new SlackWebhook();
		const result = await webhook.post({
			token: 'test-token',
			type: 'event_callback',
			event_id: 'Ev123',
			team_id: 'T123',
			event: {
				type: 'message',
				text: 'Let us switch to Redis for caching',
				user: 'U456',
				channel: 'C789',
				ts: '1234567890.123456',
			},
		});

		assert.equal(result.message, 'accepted');
		assert.equal(result.status, 200);
	});

	it('handles missing event payload gracefully', async () => {
		const webhook = new SlackWebhook();
		const result = await webhook.post({
			token: 'test-token',
			type: 'event_callback',
		});

		assert.equal(result.message, 'no_event');
	});
});

describe('SlackWebhook token verification', () => {
	it('rejects requests with wrong token', async () => {
		const webhook = new SlackWebhook();
		const result = await webhook.post({
			token: 'wrong-token',
			type: 'event_callback',
			event: { type: 'message', text: 'injected', user: 'U999', ts: '1.2' },
		});
		assert.equal(result.status, 401);
		assert.equal(result.message, 'unauthorized');
	});

	it('rejects requests with missing token', async () => {
		const webhook = new SlackWebhook();
		const result = await webhook.post({
			type: 'event_callback',
			event: { type: 'message', text: 'injected', user: 'U999', ts: '1.2' },
		});
		assert.equal(result.status, 401);
		assert.equal(result.message, 'unauthorized');
	});

	it('allows requests when SLACK_VERIFICATION_TOKEN is unset (soft-fail)', async () => {
		const saved = process.env.SLACK_VERIFICATION_TOKEN;
		delete process.env.SLACK_VERIFICATION_TOKEN;
		try {
			const webhook = new SlackWebhook();
			const result = await webhook.post({
				type: 'event_callback',
				event_id: 'Ev999',
				team_id: 'T123',
				event: { type: 'message', text: 'test message', user: 'U123', ts: '1.2' },
			});
			assert.equal(result.message, 'accepted');
		} finally {
			process.env.SLACK_VERIFICATION_TOKEN = saved;
		}
	});
});
