import { z } from 'zod';
import type { DiscussMessage } from '@recoder/shared';
import { readExcerpt } from '../pipeline/harness.js';
import {
	asLlmError,
	chatCompletion,
	streamChatCompletion,
	type ChatMessage,
	type ChatOptions
} from '../../models/llm.js';
import { configForRole, REVIEW_ROLES, type ReviewRole } from '../../models/models.js';
import { capDiff } from '../pipeline/prompts.js';
import { ROLE_FOCUS } from '../pipeline/roles.js';
import { describeFinding, findingRequestSchema } from './finding-request.js';

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

/**
 * A follow-up question about a single finding. Same read-only contract as the
 * review harness: the model gets the finding, file context, and thread history,
 * never tools or writes.
 */
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

interface DiscussReply {
	agent: string;
	model: string;
	reply: string;
}

/** Shared prompt assembly for the discuss endpoints (batch + streaming). */
async function buildDiscussMessages(input: DiscussInput, role: ReviewRole): Promise<ChatMessage[]> {
	const parts = [describeFinding(input)];

	if (input.sandboxPath) {
		const excerpt = await readExcerpt(input.sandboxPath, input.file, input.line);

		if (excerpt !== null) parts.push(`--- ${input.file} (lines around ${input.line}) ---\n${excerpt}`);
	}

	parts.push(`--- unified diff (capped) ---\n${capDiff(input.diff)}`);

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

/** Ask the finding's reviewer role, sending the request through `complete` (batch or streaming). */
async function answerDiscussion(
	input: DiscussInput,
	complete: (opts: ChatOptions) => Promise<string>
): Promise<DiscussReply> {
	const role = resolveDiscussRole(input.agent);
	const cfg = configForRole(role);

	try {
		const reply = await complete({
			...cfg,
			messages: await buildDiscussMessages(input, role),
			timeoutMs: 120_000
		});

		return { agent: role, model: cfg.model, reply: reply.trim() };
	} catch (err) {
		throw asLlmError(err);
	}
}

export function discussFinding(input: DiscussInput): Promise<DiscussReply> {
	return answerDiscussion(input, chatCompletion);
}

/** Streaming variant of {@link discussFinding} for the SSE endpoint. */
export function streamDiscussFinding(input: DiscussInput, onToken: (text: string) => void): Promise<DiscussReply> {
	return answerDiscussion(input, (opts) => streamChatCompletion(opts, onToken));
}

const discussHistorySchema = z.object({
	role: z.enum(['user', 'assistant']),
	body: z.string().min(1).max(8000)
});

export const discussRequestSchema = z.object({
	agent: z.string().min(1).max(50),
	finding: findingRequestSchema,
	history: z.array(discussHistorySchema).max(50).default([]),
	question: z.string().min(1).max(4000)
});
