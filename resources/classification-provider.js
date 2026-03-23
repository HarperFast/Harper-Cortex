/**
 * ============================================================================
 * CORTEX CLASSIFICATION PROVIDER - Provider-Agnostic LLM Classification
 * ============================================================================
 *
 * A flexible, provider-agnostic classification system for Cortex Core memories.
 * Supports multiple LLM providers with graceful degradation to local heuristics.
 *
 * SUPPORTED PROVIDERS:
 * - anthropic: Anthropic Claude API (native @anthropic-ai/sdk or fetch fallback)
 * - openai: OpenAI GPT models (fetch-based, no SDK dependency)
 * - google: Google Gemini API (fetch-based)
 * - ollama: Ollama local/self-hosted models (fetch-based)
 * - openai-compatible: OpenAI-compatible APIs (Groq, Together, Fireworks, vLLM, LM Studio)
 * - local: Keyword matching + heuristics (no API call, fallback-only)
 *
 * CONFIGURATION VIA ENVIRONMENT VARIABLES:
 * ============================================================================
 *
 * Required:
 *   CLASSIFICATION_PROVIDER = anthropic|openai|google|ollama|openai-compatible|local
 *   CLASSIFICATION_MODEL = model name for the provider
 *                          Examples:
 *                          - anthropic: "claude-sonnet-4-5-20250514", "claude-haiku-3-5-20241022"
 *                          - openai: "gpt-4o-mini", "gpt-4-turbo"
 *                          - google: "gemini-2.0-flash", "gemini-1.5-flash"
 *                          - ollama: "llama2", "mistral", "neural-chat"
 *                          - openai-compatible: model name expected by the API
 *
 * Conditionally Required:
 *   CLASSIFICATION_API_KEY = API key for provider (required for: anthropic, openai, google, openai-compatible)
 *   CLASSIFICATION_BASE_URL = Base URL (required for: ollama, openai-compatible)
 *                             Examples:
 *                             - ollama: "http://localhost:11434"
 *                             - groq: "https://api.groq.com/openai/v1"
 *                             - together: "https://api.together.xyz/v1"
 *                             - fireworks: "https://api.fireworks.ai/inference/v1"
 *                             - vllm: "http://localhost:8000/v1"
 *
 * Optional:
 *   CLASSIFICATION_TIMEOUT = API timeout in milliseconds (default: 10000)
 *   CLASSIFICATION_SYSTEM_PROMPT = Custom system prompt (default: built-in)
 *   CLASSIFICATION_LOG_LEVEL = debug|info|warn|error (default: info)
 *
 * QUICK START:
 * ============================================================================
 *
 * Using Claude (Anthropic):
 *   CLASSIFICATION_PROVIDER=anthropic
 *   CLASSIFICATION_MODEL=claude-haiku-3-5-20241022
 *   CLASSIFICATION_API_KEY=sk-ant-xxx
 *
 * Using GPT-4o Mini (OpenAI):
 *   CLASSIFICATION_PROVIDER=openai
 *   CLASSIFICATION_MODEL=gpt-4o-mini
 *   CLASSIFICATION_API_KEY=sk-xxx
 *
 * Using Gemini (Google):
 *   CLASSIFICATION_PROVIDER=google
 *   CLASSIFICATION_MODEL=gemini-2.0-flash
 *   CLASSIFICATION_API_KEY=AIzaXXX
 *
 * Using Ollama (local):
 *   CLASSIFICATION_PROVIDER=ollama
 *   CLASSIFICATION_MODEL=llama2
 *   CLASSIFICATION_BASE_URL=http://localhost:11434
 *
 * Using Groq (OpenAI-compatible):
 *   CLASSIFICATION_PROVIDER=openai-compatible
 *   CLASSIFICATION_MODEL=mixtral-8x7b-32768
 *   CLASSIFICATION_API_KEY=gsk_xxx
 *   CLASSIFICATION_BASE_URL=https://api.groq.com/openai/v1
 *
 * Using Fallback (local):
 *   CLASSIFICATION_PROVIDER=local
 *   (no API key or model required)
 *
 * USAGE:
 * ============================================================================
 *
 *   import { classifyMemory } from './classification-provider.js';
 *
 *   // Returns { classification, entities, summary } or null if unavailable
 *   const result = await classifyMemory('Text to classify');
 *
 *   if (result) {
 *     console.log(result.classification); // e.g., "decision", "action_item"
 *     console.log(result.entities);       // { people: [], projects: [], ... }
 *     console.log(result.summary);        // One-sentence summary
 *   } else {
 *     // No provider configured or unavailable; store memory without classification
 *     console.log('Classification unavailable');
 *   }
 *
 * ============================================================================
 */

/**
 * Valid classification categories
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

/**
 * Default system prompt for classification
 */
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

/**
 * Configuration from environment
 */
const config = {
	provider: process.env.CLASSIFICATION_PROVIDER || null,
	model: process.env.CLASSIFICATION_MODEL || null,
	apiKey: process.env.CLASSIFICATION_API_KEY || null,
	baseUrl: process.env.CLASSIFICATION_BASE_URL || null,
	timeout: parseInt(process.env.CLASSIFICATION_TIMEOUT || '10000', 10),
	systemPrompt: process.env.CLASSIFICATION_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT,
	logLevel: process.env.CLASSIFICATION_LOG_LEVEL || 'info',
};

/**
 * Logger
 */
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

/**
 * ============================================================================
 * PROVIDER IMPLEMENTATIONS
 * ============================================================================
 */

/**
 * Anthropic Claude provider
 */
async function classifyWithAnthropic(text) {
	if (!config.apiKey) {
		throw new Error('CLASSIFICATION_API_KEY required for Anthropic provider');
	}
	if (!config.model) {
		throw new Error('CLASSIFICATION_MODEL required for Anthropic provider');
	}

	// Try using native SDK if available
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
		// Fall back to fetch-based approach
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

/**
 * OpenAI GPT provider
 */
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

/**
 * Google Gemini provider
 */
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
		}
	);

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Google API error: ${response.status} ${error}`);
	}

	const data = await response.json();
	const responseText = data.candidates[0].content.parts[0].text;
	return JSON.parse(responseText);
}

/**
 * Ollama provider (self-hosted)
 */
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

/**
 * OpenAI-compatible provider (Groq, Together, Fireworks, vLLM, LM Studio, etc.)
 */
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

	// Add Authorization header if API key is provided
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

/**
 * Local heuristic-based fallback (no API call)
 */
async function classifyWithLocal(text) {
	const lowerText = (text || '').toLowerCase();

	// Decision keywords
	if (/decision|decided|will go with|agreed to|committed to|choosing|chose/i.test(lowerText)) {
		return {
			classification: 'decision',
			entities: extractLocalEntities(text),
			summary: text.substring(0, 100),
		};
	}

	// Action item keywords
	if (
		/action item|todo|task|@everyone|assigned|need to|must|should do|need someone to/i.test(
			lowerText
		)
	) {
		return {
			classification: 'action_item',
			entities: extractLocalEntities(text),
			summary: text.substring(0, 100),
		};
	}

	// Question keywords
	if (/\?|how do|what is|why|when will|can someone|does|has anyone/i.test(lowerText)) {
		return {
			classification: 'question',
			entities: extractLocalEntities(text),
			summary: text.substring(0, 100),
		};
	}

	// Announcement keywords
	if (/announcement|announce|launched|released|new|available|now live/i.test(lowerText)) {
		return {
			classification: 'announcement',
			entities: extractLocalEntities(text),
			summary: text.substring(0, 100),
		};
	}

	// Reference keywords
	if (/see|check|documentation|docs|link|reference|here|file|attachment|guide/i.test(lowerText)) {
		return {
			classification: 'reference',
			entities: extractLocalEntities(text),
			summary: text.substring(0, 100),
		};
	}

	// Status update keywords
	if (/update|completed|finished|progress|status|working on|done|ready/i.test(lowerText)) {
		return {
			classification: 'status_update',
			entities: extractLocalEntities(text),
			summary: text.substring(0, 100),
		};
	}

	// Feedback keywords
	if (
		/feedback|suggest|improvement|comment|thoughts|opinion|review|not working|bug|issue/i.test(
			lowerText
		)
	) {
		return {
			classification: 'feedback',
			entities: extractLocalEntities(text),
			summary: text.substring(0, 100),
		};
	}

	// Knowledge/teaching
	if (/note|remember|important|tip|trick|best practice|pattern|approach|method/i.test(lowerText)) {
		return {
			classification: 'knowledge',
			entities: extractLocalEntities(text),
			summary: text.substring(0, 100),
		};
	}

	// Default to discussion
	return {
		classification: 'discussion',
		entities: extractLocalEntities(text),
		summary: text.substring(0, 100),
	};
}

/**
 * Extract entities from text using simple heuristics
 */
function extractLocalEntities(text) {
	const entities = {
		people: [],
		projects: [],
		technologies: [],
		topics: [],
		dates: [],
	};

	if (!text) return entities;

	// Extract @mentions
	const mentions = text.match(/@(\w+)/g) || [];
	entities.people = [...new Set(mentions.map((m) => m.substring(1)))];

	// Extract #hashtags as topics
	const hashtags = text.match(/#(\w+)/g) || [];
	entities.topics = [...new Set(hashtags.map((h) => h.substring(1)))];

	// Simple date patterns (YYYY-MM-DD, MM/DD/YYYY, "tomorrow", "next week", etc.)
	const datePatterns =
		text.match(/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}|tomorrow|today|next week|next month/gi) || [];
	entities.dates = [...new Set(datePatterns)];

	return entities;
}

/**
 * ============================================================================
 * MAIN ENTRY POINT
 * ============================================================================
 */

/**
 * Classify a memory text using the configured provider.
 * Returns { classification, entities, summary } or null if unavailable.
 *
 * @param {string} text - The text to classify
 * @param {Object} options - Optional overrides
 * @returns {Promise<Object|null>} Classification result or null
 */
export async function classifyMemory(text, options = {}) {
	// Validate input
	if (!text || typeof text !== 'string' || text.trim().length === 0) {
		log('debug', 'Empty text provided for classification');
		return null;
	}

	// Use config overrides if provided
	const provider = options.provider || config.provider;
	const timeout = options.timeout || config.timeout;

	// No provider configured
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

		// Validate and normalize result
		if (!result || typeof result !== 'object') {
			log('warn', 'Provider returned non-object result, using fallback');
			return createFallbackClassification(text);
		}

		// Map old field name to new (for backward compatibility)
		const classification = result.classification || result.category || 'discussion';

		// Validate category
		if (!VALID_CATEGORIES.has(classification)) {
			log('warn', 'Invalid classification returned by provider, using fallback', {
				invalidCategory: classification,
			});
			return createFallbackClassification(text);
		}

		// Normalize entities
		const entities = result.entities || {};
		const normalizedEntities = {
			people: Array.isArray(entities.people) ? entities.people : [],
			projects: Array.isArray(entities.projects) ? entities.projects : [],
			technologies: Array.isArray(entities.technologies) ? entities.technologies : [],
			topics: Array.isArray(entities.topics) ? entities.topics : [],
			dates: Array.isArray(entities.dates) ? entities.dates : [],
		};

		// Normalize summary
		const summary =
			result.summary && typeof result.summary === 'string'
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

/**
 * Create a fallback classification when API is unavailable
 */
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

/**
 * Utility: Get current provider configuration (useful for debugging)
 */
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

/**
 * Utility: Validate configuration without making API calls
 */
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
			`CLASSIFICATION_PROVIDER "${config.provider}" is invalid. Must be one of: ${validProviders.join(', ')}`
		);
	}

	// Provider-specific validation
	if (config.provider !== 'local') {
		if (!config.model) {
			issues.push('CLASSIFICATION_MODEL required for non-local providers');
		}

		if (
			['anthropic', 'openai', 'google', 'openai-compatible'].includes(config.provider) &&
			!config.apiKey
		) {
			issues.push(
				`CLASSIFICATION_API_KEY required for ${config.provider} provider`
			);
		}

		if (['ollama', 'openai-compatible'].includes(config.provider) && !config.baseUrl) {
			issues.push(
				`CLASSIFICATION_BASE_URL required for ${config.provider} provider`
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
