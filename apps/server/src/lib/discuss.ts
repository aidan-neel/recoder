import { z } from 'zod';
import type { DiscussMessage } from '@recoder/shared';
import { readExcerpt } from './harness.js';
import { chatCompletion, LlmError } from './llm.js';
import { configForRole, REVIEW_ROLES, type ReviewRole } from './models.js';

/**
 * Follow-up discussion about a single finding. Same read-only contract as
 * the review harness: the model gets the finding, file context, and thread
 * history — never tools, never writes.
 */

const SYSTEM_PROMPT = `You are a read-only code reviewer discussing one of your own findings with the developer. You cannot change code or run commands.
Answer only from the provided finding, file context, and diff. If the context does not support an answer, say so plainly.
Be concise: a few short sentences. Format short answers as plain text; use markdown only for code or short lists.`;

export function resolveDiscussRole(agent: string): ReviewRole {
	return (REVIEW_ROLES as readonly string[]).includes(agent) ? (agent as ReviewRole) : 'security';
}

export interface DiscussInput {
	agent: string;
	file: string;
	line: number;
	endLine: number;
	severity: string;
	message: string;
	history: DiscussMessage[];
	question: string;
	diff: string;
	sandboxPath: string | null;
}

export async function discussFinding(input: DiscussInput): Promise<{ agent: string; model: string; reply: string }> {
	const role = resolveDiscussRole(input.agent);
	const cfg = configForRole(role);

	const parts = [
		`Finding (${input.severity}, ${input.file}:${input.line}-${input.endLine}): ${input.message}`
	];
	if (input.sandboxPath) {
		const excerpt = await readExcerpt(input.sandboxPath, input.file, input.line);
		if (excerpt !== null) parts.push(`--- ${input.file} (lines around ${input.line}) ---\n${excerpt}`);
	}
	const trimmedDiff =
		input.diff.length > 20000 ? input.diff.slice(0, 20000) + '\n…[diff truncated]' : input.diff;
	parts.push(`--- unified diff (capped) ---\n${trimmedDiff}`);

	const history = input.history
		.slice(-12)
		.map((m) => `${m.role === 'user' ? 'Developer' : 'Reviewer'}: ${m.body}`)
		.join('\n');

	const user = [...parts, history ? `--- thread so far ---\n${history}` : '', `Developer: ${input.question}`]
		.filter(Boolean)
		.join('\n\n');

	try {
		const reply = await chatCompletion({
			baseUrl: cfg.baseUrl,
			apiKey: cfg.apiKey,
			model: cfg.model,
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{ role: 'user', content: user }
			],
			timeoutMs: 120_000
		});
		return { agent: role, model: cfg.model, reply: reply.trim() };
	} catch (err) {
		if (err instanceof LlmError) throw err;
		throw new LlmError(0, err instanceof Error ? err.message : String(err));
	}
}

export const discussFindingSchema = z.object({
	file: z.string().min(1).max(500),
	line: z.number().int().positive(),
	endLine: z.number().int().positive(),
	severity: z.string().min(1).max(20),
	message: z.string().min(1).max(4000)
});

export const discussHistorySchema = z.object({
	role: z.enum(['user', 'assistant']),
	body: z.string().min(1).max(8000)
});

export const discussRequestSchema = z.object({
	agent: z.string().min(1).max(50),
	finding: discussFindingSchema,
	history: z.array(discussHistorySchema).max(50).default([]),
	question: z.string().min(1).max(4000)
});
