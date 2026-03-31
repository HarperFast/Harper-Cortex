/**
 * Provider-agnostic LLM classification for Cortex memories.
 * Supports Anthropic, OpenAI, Google, Ollama, OpenAI-compatible APIs, and local heuristics.
 * See README for configuration and environment variable reference.
 */

const VALID_CATEGORIES = new Set([
	'decision',
	'action_item',
	'knowledge',
	'question',
	'announcement',
	'discussion',
	'reference',
	'status_update',
	'feedback',
]);

const DEFAULT_SYSTEM_PROMPT =
	`You are a message classifier for a team memory system. Classify each message into exactly ONE category and extract key entities.

Categories: decision, action_item, knowledge, question, announcement, discussion, reference, status_update, feedback

Respond with valid JSON only, in this exact format:
{
  "classification": "<category>",
  "entities": {
    "people": [],
    "projects": [],
    "technologies": [],
    "topics": [],
    "dates": []
  },
  "summary": "<one sentence summary>"
}`;

const config = {
	provider: process.env.CLASSIFICATION_PROVIDER || null,
	model: process.env.CLASSIFICATION_MODEL || null,
	apiKey: process.env.CLASSIFICATION_API_KEY || null,
	baseUrl: process.env.CLASSIFICATION_BASE_URL || null,
	timeout: parseInt(process.env.CLASSIFICATION_TIMEOUT || '10000', 10),
	systemPrompt: process.env.CLASSIFICATION_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT,
	logLevel: process.env.CLASSIFICATION_LOG_LEVEL || 'info',
};

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function log(level, message, context = {}) {
	if (LOG_LEVELS[level] == null || LOG_LEVELS[level] < LOG_LEVELS[config.logLevel]) {
		return;
	}
	const entry = {
		timestamp: new Date().toISOString(),
		level,
		component: 'classification-provider',
		message,
		...context,
	};
	if (level === 'error') {
		console.error(JSON.stringify(entry));
	} else if (level === 'warn') {
		console.warn(JSON.stringify(entry));
	} else {
		console.log(JSON.stringify(entry));
	}
}

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

async function classifyWithAnthropic(text) {
	if (!config.apiKey) {
		throw new Error('CLASSIFICATION_API_KEY required for Anthropic provider');
	}
	if (!config.model) {
		throw new Error('CLASSIFICATION_MODEL required for Anthropic provider');
	}

	try {
		const Anthropic = (await import('@anthropic-ai/sdk')).default;
		const client = new Anthropic({ apiKey: config.apiKey });
		const message = await client.messages.create({
			model: config.model,
			max_tokens: 512,
			system: config.systemPrompt,
			messages: [
				{
					role: 'user',
					content: `Classify this message:\n\n"${text}"`,
				},
			],
		});
		return JSON.parse(message.content[0].text);
	} catch (sdkError) {
		log('debug', 'Anthropic SDK not available, using fetch', { error: sdkError.message });

		const response = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': config.apiKey,
				'anthropic-version': '2023-06-01',
			},
			signal: AbortSignal.timeout(config.timeout),
			body: JSON.stringify({
				model: config.model,
				max_tokens: 512,
				system: config.systemPrompt,
				messages: [
					{
						role: 'user',
						content: `Classify this message:\n\n"${text}"`,
					},
				],
			}),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Anthropic API error: ${response.status} ${error}`);
		}

		const data = await response.json();
		return JSON.parse(data.content[0].text);
	}
}

async function classifyWithOpenAI(text) {
	if (!config.apiKey) {
		throw new Error('CLASSIFICATION_API_KEY required for OpenAI provider');
	}
	if (!config.model) {
		throw new Error('CLASSIFICATION_MODEL required for OpenAI provider');
	}

	const response = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${config.apiKey}`,
		},
		signal: AbortSignal.timeout(config.timeout),
		body: JSON.stringify({
			model: config.model,
			temperature: 0,
			max_tokens: 512,
			system: config.systemPrompt,
			messages: [
				{
					role: 'user',
					content: `Classify this message:\n\n"${text}"`,
				},
			],
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`OpenAI API error: ${response.status} ${error}`);
	}

	const data = await response.json();
	const responseText = data.choices[0].message.content;
	return JSON.parse(responseText);
}

async function classifyWithGoogle(text) {
	if (!config.apiKey) {
		throw new Error('CLASSIFICATION_API_KEY required for Google provider');
	}
	if (!config.model) {
		throw new Error('CLASSIFICATION_MODEL required for Google provider');
	}

	const response = await fetch(
		`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			signal: AbortSignal.timeout(config.timeout),
			body: JSON.stringify({
				system_instruction: {
					parts: {
						text: config.systemPrompt,
					},
				},
				contents: {
					parts: {
						text: `Classify this message:\n\n"${text}"`,
					},
				},
				generationConfig: {
					temperature: 0,
					maxOutputTokens: 512,
				},
			}),
		},
	);

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Google API error: ${response.status} ${error}`);
	}

	const data = await response.json();
	const responseText = data.candidates[0].content.parts[0].text;
	return JSON.parse(responseText);
}

async function classifyWithOllama(text) {
	if (!config.baseUrl) {
		throw new Error('CLASSIFICATION_BASE_URL required for Ollama provider');
	}
	if (!config.model) {
		throw new Error('CLASSIFICATION_MODEL required for Ollama provider');
	}

	const baseUrl = config.baseUrl.replace(/\/$/, '');
	const response = await fetch(`${baseUrl}/api/chat`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		signal: AbortSignal.timeout(config.timeout),
		body: JSON.stringify({
			model: config.model,
			messages: [
				{
					role: 'system',
					content: config.systemPrompt,
				},
				{
					role: 'user',
					content: `Classify this message:\n\n"${text}"`,
				},
			],
			temperature: 0,
			stream: false,
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Ollama API error: ${response.status} ${error}`);
	}

	const data = await response.json();
	return JSON.parse(data.message.content);
}

async function classifyWithOpenAICompatible(text) {
	if (!config.baseUrl) {
		throw new Error('CLASSIFICATION_BASE_URL required for OpenAI-compatible provider');
	}
	if (!config.model) {
		throw new Error('CLASSIFICATION_MODEL required for OpenAI-compatible provider');
	}

	const baseUrl = config.baseUrl.replace(/\/$/, '');
	const headers = {
		'Content-Type': 'application/json',
	};

	if (config.apiKey) {
		headers.Authorization = `Bearer ${config.apiKey}`;
	}

	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: 'POST',
		headers,
		signal: AbortSignal.timeout(config.timeout),
		body: JSON.stringify({
			model: config.model,
			temperature: 0,
			max_tokens: 512,
			messages: [
				{
					role: 'system',
					content: config.systemPrompt,
				},
				{
					role: 'user',
					content: `Classify this message:\n\n"${text}"`,
				},
			],
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`OpenAI-compatible API error: ${response.status} ${error}`);
	}

	const data = await response.json();
	const responseText = data.choices[0].message.content;
	return JSON.parse(responseText);
}

async function classifyWithLocal(text) {
	const lowerText = (text || '').toLowerCase();

	if (/decision|decided|will go with|agreed to|committed to|choosing|chose/i.test(lowerText)) {
		return {
			classification: 'decision',
			entities: extractLocalEntities(text),
			summary: text.substring(0, 100),
		};
	}

	if (
		/action item|todo|task|@everyone|assigned|need to|must|should do|need someone to/i.test(
			lowerText,
		)
	) {
		return {
			classification: 'action_item',
			entities: extractLocalEntities(text),
			summary: text.substring(0, 100),
		};
	}

	if (/\?|how do|what is|why|when will|can someone|does|has anyone/i.test(lowerText)) {
		return {
			classification: 'question',
			entities: extractLocalEntities(text),
			summary: text.substring(0, 100),
		};
	}

	if (/announcement|announce|launched|released|new|available|now live/i.test(lowerText)) {
		return {
			classification: 'announcement',
			entities: extractLocalEntities(text),
			summary: text.substring(0, 100),
		};
	}

	if (/see|check|documentation|docs|link|reference|here|file|attachment|guide/i.test(lowerText)) {
		return {
			classification: 'reference',
			entities: extractLocalEntities(text),
			summary: text.substring(0, 100),
		};
	}

	if (/update|completed|finished|progress|status|working on|done|ready/i.test(lowerText)) {
		return {
			classification: 'status_update',
			entities: extractLocalEntities(text),
			summary: text.substring(0, 100),
		};
	}

	if (
		/feedback|suggest|improvement|comment|thoughts|opinion|review|not working|bug|issue/i.test(
			lowerText,
		)
	) {
		return {
			classification: 'feedback',
			entities: extractLocalEntities(text),
			summary: text.substring(0, 100),
		};
	}

	if (/note|remember|important|tip|trick|best practice|pattern|approach|method/i.test(lowerText)) {
		return {
			classification: 'knowledge',
			entities: extractLocalEntities(text),
			summary: text.substring(0, 100),
		};
	}

	return {
		classification: 'discussion',
		entities: extractLocalEntities(text),
		summary: text.substring(0, 100),
	};
}

function extractLocalEntities(text) {
	const entities = {
		people: [],
		projects: [],
		technologies: [],
		topics: [],
		dates: [],
	};

	if (!text) { return entities; }

	const mentions = text.match(/@(\w+)/g) || [];
	entities.people = [...new Set(mentions.map((m) => m.substring(1)))];

	const hashtags = text.match(/#(\w+)/g) || [];
	entities.topics = [...new Set(hashtags.map((h) => h.substring(1)))];

	const datePatterns = text.match(/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}|tomorrow|today|next week|next month/gi)
		|| [];
	entities.dates = [...new Set(datePatterns)];

	return entities;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Classify a memory text using the configured provider.
 * Returns { classification, entities, summary } or null if no provider is configured.
 */
export async function classifyMemory(text, options = {}) {
	if (!text || typeof text !== 'string' || text.trim().length === 0) {
		log('debug', 'Empty text provided for classification');
		return null;
	}

	const provider = options.provider || config.provider;
	const timeout = options.timeout || config.timeout;

	if (!provider) {
		log('debug', 'No classification provider configured, skipping classification');
		return null;
	}

	try {
		log('debug', 'Classifying text', { provider, textLength: text.length });

		let result;
		const controller = new AbortController();
		const timeoutHandle = setTimeout(() => controller.abort(), timeout);

		try {
			switch (provider) {
				case 'anthropic':
					result = await classifyWithAnthropic(text);
					break;
				case 'openai':
					result = await classifyWithOpenAI(text);
					break;
				case 'google':
					result = await classifyWithGoogle(text);
					break;
				case 'ollama':
					result = await classifyWithOllama(text);
					break;
				case 'openai-compatible':
					result = await classifyWithOpenAICompatible(text);
					break;
				case 'local':
					result = await classifyWithLocal(text);
					break;
				default:
					log('warn', `Unknown provider: ${provider}, falling back to local`);
					result = await classifyWithLocal(text);
					break;
			}
		} finally {
			clearTimeout(timeoutHandle);
		}

		if (!result || typeof result !== 'object') {
			log('warn', 'Provider returned non-object result, using fallback');
			return createFallbackClassification(text);
		}

		const classification = result.classification || result.category || 'discussion';

		if (!VALID_CATEGORIES.has(classification)) {
			log('warn', 'Invalid classification returned by provider, using fallback', {
				invalidCategory: classification,
			});
			return createFallbackClassification(text);
		}

		const entities = result.entities || {};
		const normalizedEntities = {
			people: Array.isArray(entities.people) ? entities.people : [],
			projects: Array.isArray(entities.projects) ? entities.projects : [],
			technologies: Array.isArray(entities.technologies) ? entities.technologies : [],
			topics: Array.isArray(entities.topics) ? entities.topics : [],
			dates: Array.isArray(entities.dates) ? entities.dates : [],
		};

		const summary = result.summary && typeof result.summary === 'string'
			? result.summary.substring(0, 500)
			: text.substring(0, 100);

		const normalized = {
			classification,
			entities: normalizedEntities,
			summary,
		};

		log('debug', 'Classification successful', { classification });
		return normalized;
	} catch (err) {
		log('error', 'Classification failed', {
			provider,
			error: err.message,
		});
		return createFallbackClassification(text);
	}
}

function createFallbackClassification(text) {
	return {
		classification: 'discussion',
		entities: {
			people: [],
			projects: [],
			technologies: [],
			topics: [],
			dates: [],
		},
		summary: String(text || '').substring(0, 100),
	};
}

/** Get current provider configuration (useful for debugging). */
export function getProviderConfig() {
	return {
		provider: config.provider || 'none',
		model: config.model || 'none',
		timeout: config.timeout,
		logLevel: config.logLevel,
		hasApiKey: !!config.apiKey,
		hasBaseUrl: !!config.baseUrl,
	};
}

/** Validate configuration without making API calls. */
export function validateConfig() {
	const issues = [];

	if (!config.provider) {
		issues.push('CLASSIFICATION_PROVIDER not set');
		return { valid: false, issues };
	}

	const validProviders = [
		'anthropic',
		'openai',
		'google',
		'ollama',
		'openai-compatible',
		'local',
	];
	if (!validProviders.includes(config.provider)) {
		issues.push(
			`CLASSIFICATION_PROVIDER "${config.provider}" is invalid. Must be one of: ${validProviders.join(', ')}`,
		);
	}

	if (config.provider !== 'local') {
		if (!config.model) {
			issues.push('CLASSIFICATION_MODEL required for non-local providers');
		}

		if (
			['anthropic', 'openai', 'google', 'openai-compatible'].includes(config.provider)
			&& !config.apiKey
		) {
			issues.push(
				`CLASSIFICATION_API_KEY required for ${config.provider} provider`,
			);
		}

		if (['ollama', 'openai-compatible'].includes(config.provider) && !config.baseUrl) {
			issues.push(
				`CLASSIFICATION_BASE_URL required for ${config.provider} provider`,
			);
		}
	}

	return {
		valid: issues.length === 0,
		issues,
	};
}

export default {
	classifyMemory,
	getProviderConfig,
	validateConfig,
};
