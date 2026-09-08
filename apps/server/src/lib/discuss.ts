import { z } from 'zod';
import type { DiscussMessage } from '@recoder/shared';
import { readExcerpt } from './harness.js';
import { chatCompletion, streamChatCompletion, LlmError, type ChatMessage } from './llm.js';
import { configForRole, REVIEW_ROLES, type ReviewRole } from './models.js';
import { ROLE_FOCUS } from './roles.js';

/**
 * Follow-up discussion about a single finding. Same read-only contract as
 * the review harness: the model gets the finding, file context, and thread
 * history — never tools, never writes.
 */

/**
 * Fierce senior-engineer discuss persona: defend the finding with evidence,
 * push back when the developer is wrong, concede crisply when they are
 * right, and yield explicitly (naming the trade-off) when overridden.
 */
function discussSystemPrompt(role: ReviewRole): string {
	return `You are a fierce staff engineer defending your own ${role} review finding with a developer. You cannot change code or run commands. Your lens: ${ROLE_FOCUS[role]}.
You believe in this finding until evidence moves you. The developer will push back — good. Engage: argue from the finding, the file context, and the diff, with file:line citations. Never invent evidence; if the context does not support an answer, say so plainly.
If the developer is right, concede crisply and say exactly what changed your mind. No groveling, no hedging.
If they insist after your best case, yield explicitly: name the trade-off being accepted, then let them override. They own the call.
Know this repo's grain from the context provided: defend the conventions this codebase actually uses, and talk the developer out of patterns it rejects (an OOP hierarchy in a functional codebase, framework idioms it doesn't use) — with examples, not taste.
Be concise: a few short sentences. Plain text; markdown only for code or short lists.`;
}

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

/** Shared prompt assembly for the discuss endpoints (batch + streaming). */
async function buildDiscussMessages(input: DiscussInput, role: ReviewRole): Promise<ChatMessage[]> {
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

	return [
		{ role: 'system', content: discussSystemPrompt(role) },
		{ role: 'user', content: user }
	];
}

export async function discussFinding(input: DiscussInput): Promise<{ agent: string; model: string; reply: string }> {
	const role = resolveDiscussRole(input.agent);
	const cfg = configForRole(role);

	try {
		const reply = await chatCompletion({
			baseUrl: cfg.baseUrl,
			apiKey: cfg.apiKey,
			model: cfg.model,
			messages: await buildDiscussMessages(input, role),
			timeoutMs: 120_000
		});
		return { agent: role, model: cfg.model, reply: reply.trim() };
	} catch (err) {
		if (err instanceof LlmError) throw err;
		throw new LlmError(0, err instanceof Error ? err.message : String(err));
	}
}

/** Streaming variant of {@link discussFinding} for the SSE endpoint. */
export async function streamDiscussFinding(
	input: DiscussInput,
	onToken: (text: string) => void
): Promise<{ agent: string; model: string; reply: string }> {
	const role = resolveDiscussRole(input.agent);
	const cfg = configForRole(role);

	try {
		const reply = await streamChatCompletion(
			{
				baseUrl: cfg.baseUrl,
				apiKey: cfg.apiKey,
				model: cfg.model,
				messages: await buildDiscussMessages(input, role),
				timeoutMs: 120_000
			},
			onToken
		);
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
