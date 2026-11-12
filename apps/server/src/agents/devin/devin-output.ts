import { readFile } from 'node:fs/promises';
import type { TokenUsage } from '@recoder/shared';
import { z } from 'zod';
import { LlmError } from '../../models/llm/errors';

export const DEVIN_LOGIN = 'devin auth login';

const SIGNED_OUT = /not logged in|log ?in required|please (?:log|sign) ?in|unauthenticated|auth login/i;

const LIMIT = /rate.?limit|quota|usage limit|too many requests|insufficient credit/i;

/** Longest stretch of the CLI's output quoted in an error. */
const QUOTED_CHARS = 300;

const exportSchema = z.object({
	session_id: z.string().optional(),
	final_metrics: z
		.object({
			total_prompt_tokens: z.number().optional(),
			total_completion_tokens: z.number().optional(),
			total_cached_tokens: z.number().optional()
		})
		.optional()
});

export type DevinExport = z.infer<typeof exportSchema>;

/** The conversation the CLI exported, or null when it wrote none or one that does not match the schema. */
export async function readExport(file: string): Promise<DevinExport | null> {
	try {
		return exportSchema.parse(JSON.parse(await readFile(file, 'utf8')));
	} catch {
		return null;
	}
}

/**
 * The line to quote in an error, trimmed and cut: the CLI's `Error:` line when it printed one, since a JSON body
 * can follow it (a rate limit ends in `}`), else the last non-empty line.
 */
function errorLine(text: string): string | undefined {
	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);

	return (lines.find((line) => /^error\b/i.test(line)) ?? lines.at(-1))?.slice(0, QUOTED_CHARS);
}

/** `prompt_tokens` already counts the cached ones, as the export's own totals show. A count the export lacks is unknown, not 0. */
export function tokenUsage(metrics: NonNullable<DevinExport['final_metrics']>): TokenUsage {
	const inputTokens = metrics.total_prompt_tokens ?? null;
	const outputTokens = metrics.total_completion_tokens ?? null;

	return {
		inputTokens,
		outputTokens,
		totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
		cachedInputTokens: metrics.total_cached_tokens ?? null,
		cacheWriteInputTokens: null,
		reasoningOutputTokens: null
	};
}

/** A failed call's error: signed out is a 401 and a spent plan a 429, so the app can say so. */
function devinError(text: string): LlmError {
	if (SIGNED_OUT.test(text)) return new LlmError(401, `Devin is signed out. Run: ${DEVIN_LOGIN}`);

	return new LlmError(LIMIT.test(text) ? 429 : 0, text);
}

/** The error of a run that exited non-zero, from its stderr, else its stdout, else its exit code. */
export function exitError(exit: { code: number; stderr: string }, stdout: string): LlmError {
	return devinError(errorLine(exit.stderr) ?? errorLine(stdout) ?? `Devin exited with code ${exit.code}.`);
}
