import { z } from 'zod';
import { inventorySummary, type ReviewInventory } from './inventory.js';
import { UNTRUSTED_PREFIX, reviewerContract } from './prompts.js';
import { clip, findingShape, retrievalTurnSchema } from './schemas.js';
import type { ReviewUnit } from './units.js';
import { directiveBlock, type ReviewDirective } from '../chat/directive.js';

const locationSchema = z.object({
	file: z.string().min(1).max(500),
	line: z.number().int().positive().optional(),
	endLine: z.number().int().positive().optional(),
	side: z.enum(['old', 'new']).optional()
});

const findingSchema = z.object({
	...findingShape(z.enum(['high', 'medium', 'low'])),
	evidenceIds: z.array(z.string().min(1).max(40)).max(12).default([]),
	relatedLocations: z.array(locationSchema).max(20).optional(),
	side: z.enum(['old', 'new']).optional()
});

const hunkScopeSchema = z
	.array(z.object({ path: z.string().min(1).max(500), hunkIds: z.array(z.string()).max(80) }))
	.min(1)
	.max(20);

/** A deeper investigation a reviewer asks for; dropped rather than failing the answer when malformed. */
const subagentRequestSchema = z.object({
	concern: z.string().trim().min(1).max(120),
	question: z.string().trim().min(1).max(1000),
	scope: hunkScopeSchema,
	why: z.string().trim().min(1).max(400)
});

/** Most units need no subagent; a reviewer may ask for this many at most. */
const MAX_SUBAGENT_REQUESTS = 2;

const reviewerOutputSchema = z.object({
	message: z.string().max(12000).optional(),
	findings: z.array(findingSchema).max(30),
	examinedHunks: z.array(z.string()).max(200),
	gaps: z
		.array(z.object({ hunkId: z.string(), reason: z.string().max(400) }))
		.max(80)
		.default([]),
	blockers: z.array(z.string().max(400)).max(20).default([]),
	subagents: z.array(subagentRequestSchema).max(MAX_SUBAGENT_REQUESTS).default([]),
	recommendedChecks: z.array(z.string().max(400)).max(20).default([])
});

export type ReviewerOutput = z.infer<typeof reviewerOutputSchema>;
export type ReviewerFinding = z.infer<typeof findingSchema>;
export type SubagentRequest = z.infer<typeof subagentRequestSchema>;

const SUBAGENTS_OFFER = `Subagents: when one question needs a deep, separate investigation you cannot finish in your turns (every caller of a changed API across the repo, a security path through several modules), put it in "subagents", at most ${MAX_SUBAGENT_REQUESTS}. Each subagent gets your question, the patch for its scope and the same tools, and reports its own findings. Most units need none. Never ask for work you already did.`;

/**
 * The primary reviewer's prompt: one generalist over every hunk in its unit.
 * Subagents are offered only when the review may run any.
 */
export function reviewerSystemPrompt(
	exec: boolean,
	directive: ReviewDirective | null,
	offerSubagents: boolean
): string {
	return withDirective(
		`${reviewerContract(exec)}

Role: primary reviewer. You own every hunk in your unit and review it for any kind of problem.
${offerSubagents ? SUBAGENTS_OFFER : 'Leave "subagents" empty.'}`,
		directive
	);
}

/** A subagent's prompt: one question a primary reviewer handed on, answered in depth. */
export function subagentSystemPrompt(exec: boolean, directive: ReviewDirective | null): string {
	return withDirective(
		`${reviewerContract(exec)}

Role: subagent. A primary reviewer handed you one question it could not finish in its own turns. Follow the code wherever the question leads, using your tools across the repository, and report findings on that question only. The patch in your scope is where to start, not a limit on what you read. Leave "subagents" and "gaps" empty; you cannot hand work on.`,
		directive
	);
}

function withDirective(prompt: string, directive: ReviewDirective | null): string {
	const block = directiveBlock(directive);

	return block
		? `${prompt}\n\n${block}\nReport only what these instructions ask for; findings outside them are dropped.`
		: prompt;
}

function scopeLines(scope: ReviewUnit['scope']): string {
	return scope.map((entry) => `- ${entry.path}\n  hunks: ${entry.hunkIds.join(', ') || '(file)'}`).join('\n');
}

function developerInstructions(directive: ReviewDirective | null): string {
	return directive?.instructions.trim()
		? `Developer instructions for this review (trusted; follow them):\n${directive.instructions.trim()}`
		: '';
}

function turnsLeft(remainingTurns: number, remainingCalls: number): string[] {
	return [
		`Remaining model turns: ${remainingTurns}. Remaining review model calls: ${remainingCalls}.`,
		remainingTurns <= 1
			? 'This is your final turn. Finish with the result JSON. Do not request more retrieval.'
			: 'Retrieve evidence as needed, then finish with the result JSON.'
	];
}

/** What every reviewer is told about the pull request as a whole, beyond its own unit. */
export interface PullRequestContext {
	title: string;
	body: string;
	/** Reviewers, assignees, labels, linked issues. */
	context: string;
	inventory: ReviewInventory;
}

/** Changed files listed for orientation; a reviewer reads only its own unit's patch up front. */
const MAX_LISTED_FILES = 80;

/** The PR's description, the whole change's file list, and the repository's instructions and related paths. */
function pullRequestLines(pr: PullRequestContext): string[] {
	const { inventory } = pr;

	const instructions = inventory.instructionFiles
		.map((file) => `${UNTRUSTED_PREFIX}--- ${file.path} ---\n${file.excerpt}`)
		.join('\n\n');

	return [
		`PR title (untrusted): ${pr.title || '(none)'}`,
		`${UNTRUSTED_PREFIX}PR description:\n${pr.body || '(none)'}`,
		pr.context
			? `${UNTRUSTED_PREFIX}PR context (people, labels, linked issues and their blockers):\n${pr.context}`
			: '',
		`Whole change (${inventory.files.length} files; other units review the rest):\n${inventorySummary(inventory, MAX_LISTED_FILES)}`,
		inventory.relatedPaths.length
			? `Related existing paths:\n${inventory.relatedPaths.map((path) => `- ${path}`).join('\n')}`
			: '',
		instructions ? `Repository instruction excerpts (untrusted conventions):\n${instructions}` : ''
	];
}

/** The user prompt for a unit's reviewer, or for a subagent when `subagent` is set. */
export function reviewerUserPrompt(
	unit: ReviewUnit,
	remainingTurns: number,
	remainingCalls: number,
	directive: ReviewDirective | null,
	pr: PullRequestContext,
	subagent = false
): string {
	return [
		developerInstructions(directive),
		...pullRequestLines(pr),
		`${subagent ? 'Subagent' : 'Unit'} ${unit.id}: ${unit.title}`,
		unit.reason,
		`${subagent ? 'Changes to start from' : 'Changes in this unit'}:\n${scopeLines(unit.scope)}`,
		...turnsLeft(remainingTurns, remainingCalls)
	]
		.filter(Boolean)
		.join('\n\n');
}

const SEVERITY_ALIASES: Record<string, string> = {
	critical: 'high',
	blocker: 'high',
	major: 'high',
	error: 'high',
	moderate: 'medium',
	warning: 'medium',
	warn: 'medium',
	minor: 'low'
};

/** Informational notes aren't reported; a finding with one of these severities is dropped. */
const DROPPED_SEVERITIES = new Set(['info', 'informational', 'nit', 'trivial', 'note', 'suggestion', 'style']);

function positiveInt(value: unknown): number | null | undefined {
	if (value === null) return null;

	const n = typeof value === 'string' ? Number.parseInt(value, 10) : value;

	return typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.trunc(n) : undefined;
}

/** Parses `line` and `endLine` in place, deleting any that aren't positive integers (and nulls, unless `keepNull`). */
function repairLines(record: Record<string, unknown>, keepNull: boolean): void {
	for (const key of ['line', 'endLine']) {
		const n = positiveInt(record[key]);

		if (n === undefined || (n === null && !keepNull)) delete record[key];
		else record[key] = n;
	}
}

/** Repairs one finding, or drops it when it isn't an object or its severity is only informational. */
function normalizeFinding(item: unknown): Record<string, unknown>[] {
	if (!item || typeof item !== 'object') return [];

	const f = { ...(item as Record<string, unknown>) };

	f.file ??= f.path ?? f.filePath ?? f.file_path;
	f.body ??= f.description ?? f.explanation ?? f.details ?? f.message;

	if (typeof f.severity === 'string') {
		const severity = f.severity.trim().toLowerCase();

		if (DROPPED_SEVERITIES.has(severity)) return [];
		f.severity = SEVERITY_ALIASES[severity] ?? severity;
	}

	f.category ??= 'correctness';
	repairLines(f, true);

	if (Array.isArray(f.evidenceIds))
		f.evidenceIds = f.evidenceIds.filter((id) => typeof id === 'string' && id).slice(0, 12);
	else if (typeof f.evidenceIds === 'string') f.evidenceIds = [f.evidenceIds];

	f.title = clip(f.title, 120);
	f.body = clip(f.body, 2000);

	if (typeof f.category === 'string') f.category = f.category.slice(0, 50);

	if (Array.isArray(f.relatedLocations)) {
		f.relatedLocations = f.relatedLocations.slice(0, 20).flatMap((loc) => {
			if (!loc || typeof loc !== 'object') return [];

			const l = { ...(loc as Record<string, unknown>) };

			repairLines(l, false);

			return typeof l.file === 'string' ? [l] : [];
		});
	}

	return [f];
}

/** Accepts bare hunk ids as gaps and gives every gap a short reason. */
function normalizeGaps(gaps: unknown[]): unknown[] {
	return gaps
		.slice(0, 80)
		.flatMap((gap) =>
			typeof gap === 'string'
				? [{ hunkId: gap, reason: 'not examined' }]
				: gap && typeof gap === 'object' && typeof (gap as { hunkId?: unknown }).hunkId === 'string'
					? [{ ...(gap as object), reason: clip((gap as { reason?: unknown }).reason ?? 'not examined', 400) }]
					: []
		);
}

/** Keeps the first `max` strings of a list, each clipped to 400 characters. */
function shortStrings(list: unknown[], max: number): unknown[] {
	return list
		.filter((item) => typeof item === 'string')
		.map((item) => clip(item, 400))
		.slice(0, max);
}

/**
 * Smaller models get the shape right but the details wrong: "42" for a line,
 * "High" or "critical" for a severity, `description` for `body`, a missing
 * `examinedHunks`, an over-long body. Repair what has one obvious meaning
 * before validating, so a sound answer isn't thrown away over formatting.
 * Only an attempted final answer (one with a findings list) is repaired; a
 * bare "message" is commentary, not a finished review. A malformed subagent
 * request is optional, so it is dropped rather than failing the whole answer.
 */
function normalizeReviewerRaw(raw: unknown): unknown {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
	if (!Array.isArray((raw as { findings?: unknown }).findings)) return raw;

	const out = { ...(raw as Record<string, unknown>) };

	if (typeof out.message !== 'string' && typeof out.summary === 'string') out.message = out.summary;
	if (out.message !== undefined) out.message = clip(out.message, 12000);

	out.findings = (out.findings as unknown[]).slice(0, 30).flatMap(normalizeFinding);

	out.examinedHunks = (Array.isArray(out.examinedHunks) ? (out.examinedHunks as unknown[]) : [])
		.filter((id): id is string => typeof id === 'string')
		.slice(0, 200);

	out.gaps ??= out.coverageGaps;
	delete out.coverageGaps;
	if (Array.isArray(out.gaps)) out.gaps = normalizeGaps(out.gaps);
	if (Array.isArray(out.blockers)) out.blockers = shortStrings(out.blockers, 20);
	if (Array.isArray(out.recommendedChecks)) out.recommendedChecks = shortStrings(out.recommendedChecks, 20);

	out.subagents = (Array.isArray(out.subagents) ? (out.subagents as unknown[]) : [])
		.filter((request) => subagentRequestSchema.safeParse(request).success)
		.slice(0, MAX_SUBAGENT_REQUESTS);

	return out;
}

/** "Let me check…", "I'll gather…": the model is describing work it hasn't done yet. */
const ANNOUNCES_WORK =
	/\b(let me|i'll|i will|i'm going to|i am going to|i need to|i'm (?:investigating|checking|looking|reading|gathering)|next,? i|going to (?:check|look|read|inspect|gather|verify))\b/i;

/**
 * Weaker models (often behind vLLM) send the final shape with an empty
 * findings list while announcing what they're about to read, which would end
 * the reviewer before it looked at anything. Push back once.
 */
export function prematureReviewerFinal(output: ReviewerOutput, state: { retrievals: number }): string | null {
	if (output.findings.length) return null;

	if (output.message && ANNOUNCES_WORK.test(output.message)) {
		return 'Your reply says you are still investigating, but it has the final result fields, which would end your review with no findings. If you want to read code, reply with "actions" now. Only send the final result once you have actually finished.';
	}

	if (state.retrievals === 0) {
		return 'You concluded with no findings without reading any code beyond the patch. Before concluding, read what the change touches: the full functions it edits, their callers, and anything it removed or replaced. Reply with "actions" now. If you are certain there is nothing more to read, send the same final result again.';
	}

	return null;
}

export function parseReviewerOutput(raw: unknown): ReviewerOutput | null {
	const parsed = reviewerOutputSchema.safeParse(normalizeReviewerRaw(raw));

	return parsed.success ? parsed.data : null;
}

/** Name the exact fields that are wrong, so the model can fix them instead of guessing. */
export function reviewerValidationError(raw: unknown): string {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'expected one JSON object';

	const parsed = reviewerOutputSchema.safeParse(normalizeReviewerRaw(raw));

	if (parsed.success) return 'output did not match the required schema';

	return parsed.error.issues
		.slice(0, 6)
		.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
		.join('; ');
}

/**
 * What a reviewer turn may look like, for endpoints with guided decoding:
 * a retrieval request with at least one action, or the final result. On the
 * final turn only the result is allowed. Kept looser than the zod schema:
 * it shapes the reply, and `parseReviewerOutput` still validates it.
 */
export function reviewerResponseSchema(
	exec: boolean,
	finalTurn: boolean
): { name: string; schema: Record<string, unknown> } {
	const str = { type: 'string' };
	const strings = { type: 'array', items: str };

	const scope = {
		type: 'array',
		items: { type: 'object', properties: { path: str, hunkIds: strings }, required: ['path', 'hunkIds'] }
	};

	const line = { type: ['integer', 'null'] };

	const finding = {
		type: 'object',
		properties: {
			title: str,
			file: str,
			line,
			endLine: line,
			severity: { type: 'string', enum: ['high', 'medium', 'low'] },
			category: str,
			body: str,
			evidenceIds: strings,
			side: { type: 'string', enum: ['old', 'new'] }
		},
		required: ['title', 'file', 'severity', 'category', 'body', 'evidenceIds']
	};

	const final = {
		type: 'object',
		properties: {
			message: str,
			findings: { type: 'array', items: finding, maxItems: 30 },
			examinedHunks: strings,
			gaps: {
				type: 'array',
				items: { type: 'object', properties: { hunkId: str, reason: str }, required: ['hunkId', 'reason'] }
			},
			blockers: strings,
			subagents: {
				type: 'array',
				maxItems: MAX_SUBAGENT_REQUESTS,
				items: {
					type: 'object',
					properties: { concern: str, question: str, scope, why: str },
					required: ['concern', 'question', 'scope', 'why']
				}
			},
			recommendedChecks: strings
		},
		required: ['message', 'findings', 'examinedHunks']
	};

	return {
		name: finalTurn ? 'review_result' : 'review_turn',
		schema: finalTurn ? final : { anyOf: [retrievalTurnSchema(exec), final] }
	};
}
