import { LlmError } from './errors';
import type { ChatOptions } from './types';

/** Endpoints that rejected `chat_template_kwargs`; later calls leave it off. */
const noTemplateKwargs = new Set<string>();

/** Endpoints that rejected `json_schema` response formats; later calls send plain JSON mode. */
const noJsonSchema = new Set<string>();

/** vLLM/SGLang templates read `enable_thinking`; strict providers may reject the field. */
export function thinkingFields(opts: ChatOptions): Record<string, unknown> {
	return opts.thinking === false && !noTemplateKwargs.has(opts.baseUrl)
		? { chat_template_kwargs: { enable_thinking: false } }
		: {};
}

export function responseFormat(opts: ChatOptions): Record<string, unknown> {
	if (opts.jsonSchema && !noJsonSchema.has(opts.baseUrl))
		return {
			response_format: {
				type: 'json_schema',
				json_schema: { name: opts.jsonSchema.name, schema: opts.jsonSchema.schema }
			}
		};

	return opts.jsonMode || opts.jsonSchema ? { response_format: { type: 'json_object' } } : {};
}

/** OpenRouter takes effort as `reasoning: { effort }`; other OpenAI-compatible servers take `reasoning_effort`. */
export function reasoningFields(opts: Pick<ChatOptions, 'baseUrl' | 'reasoningEffort'>): Record<string, unknown> {
	if (opts.reasoningEffort === undefined) return {};

	return /(^|\.)openrouter\.ai$/i.test(hostOf(opts.baseUrl))
		? { reasoning: { effort: opts.reasoningEffort } }
		: { reasoning_effort: opts.reasoningEffort };
}

function hostOf(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return '';
	}
}

/**
 * Run `run`, and when it fails with an error `refused` recognizes, remember the
 * endpoint in `skip` and run once more (the request then leaves the field off).
 */
async function withFieldFallback<T>(
	opts: ChatOptions,
	skip: Set<string>,
	refused: (err: LlmError) => boolean,
	run: () => Promise<T>
): Promise<T> {
	try {
		return await run();
	} catch (err) {
		if (!skip.has(opts.baseUrl) && err instanceof LlmError && refused(err)) {
			skip.add(opts.baseUrl);
			if (opts.signal?.aborted) throw err;

			return run();
		}

		throw err;
	}
}

/** Retry in plain JSON mode when an endpoint refuses a schema-constrained reply. */
export function withSchemaFallback<T>(opts: ChatOptions, run: () => Promise<T>): Promise<T> {
	if (!opts.jsonSchema) return run();

	return withFieldFallback(
		opts,
		noJsonSchema,
		(err) =>
			(err.status === 400 || err.status === 422) && /response_format|json_schema|guided|structured/i.test(err.message),
		run
	);
}

/** Retry once without the thinking switch when an endpoint refuses it. */
export function withThinkingFallback<T>(opts: ChatOptions, run: () => Promise<T>): Promise<T> {
	if (opts.thinking !== false) return run();

	return withFieldFallback(
		opts,
		noTemplateKwargs,
		(err) =>
			err.status >= 400 &&
			err.status < 500 &&
			/chat_template_kwargs|enable_thinking|unrecognized|unknown (field|parameter)|extra (fields|inputs)/i.test(
				err.message
			),
		run
	);
}
