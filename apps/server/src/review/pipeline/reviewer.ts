import { z } from 'zod';
import { FINDING_CATEGORIES, READABILITY_SMELLS, type FindingCategory } from '@recoder/shared';
import { reviewerFindingSchema } from './finding-schema.js';
import {
	ANSWERED_RESPONSE,
	answeredSchema,
	briefQuestionId,
	normalizeAnswered,
	questionIds,
	MAX_QUESTIONS
} from './reviewer-questions.js';
import { MAX_SUBAGENT_REQUESTS } from './reviewer-prompts.js';
import { clip, retrievalTurnSchema } from './schemas.js';

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

const reviewerOutputSchema = z.object({
	message: z.string().max(12000).optional(),
	findings: z.array(reviewerFindingSchema).max(30),
	examinedHunks: z.array(z.string()).max(200),
	gaps: z
		.array(z.object({ hunkId: z.string(), reason: z.string().max(400) }))
		.max(80)
		.default([]),
	blockers: z.array(z.string().max(400)).max(20).default([]),
	subagents: z.array(subagentRequestSchema).max(MAX_SUBAGENT_REQUESTS).default([]),
	unsettled: z.array(z.string()).max(MAX_QUESTIONS).default([]),
	answered: z.array(answeredSchema).max(MAX_QUESTIONS).default([]),
	recommendedChecks: z.array(z.string().max(400)).max(20).default([])
});

export type ReviewerOutput = z.infer<typeof reviewerOutputSchema>;
export type SubagentRequest = z.infer<typeof subagentRequestSchema>;

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

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** "src/a.ts:42" as a step, the way models often write one. */
const STEP_TEXT = /^(.+?):(\d+)\b\s*(.*)$/;

/** One `{file, line, note}` step from an object or "file:line note" text; null when it names no line. */
function repairStep(step: unknown): Record<string, unknown> | null {
	if (typeof step === 'string') {
		const match = STEP_TEXT.exec(step.trim());

		return match
			? { file: match[1], line: Number(match[2]), ...(match[3] ? { note: clip(match[3], 200) } : {}) }
			: null;
	}

	if (!isRecord(step)) return null;

	const file = step.file ?? step.path;
	const line = positiveInt(step.line);

	if (typeof file !== 'string' || !file || !line) return null;

	return { file, line, ...(typeof step.note === 'string' ? { note: clip(step.note, 200) } : {}) };
}

/** Repairs a list of steps, dropping any that don't name a file and line. */
function repairSteps(value: unknown, max: number): Record<string, unknown>[] {
	if (!Array.isArray(value)) return [];

	return value
		.map(repairStep)
		.filter((step): step is Record<string, unknown> => step !== null)
		.slice(0, max);
}

const CLAIM_TEXT = ['trigger', 'consequence', 'violatedContract'] as const;

/**
 * Models often put the claim's fields beside it instead of inside it, or name
 * the contract "expected". Lift them in, so validation only fails a claim that
 * is really missing a part.
 */
function repairClaim(f: Record<string, unknown>): void {
	const claim: Record<string, unknown> = isRecord(f.claim) ? { ...f.claim } : {};

	for (const key of [...CLAIM_TEXT, 'executionPath', 'existingGuard', 'contract', 'expected']) {
		if (claim[key] === undefined && f[key] !== undefined) claim[key] = f[key];

		delete f[key];
	}

	claim.violatedContract ??= claim.contract ?? claim.expected;
	delete claim.contract;
	delete claim.expected;

	for (const key of CLAIM_TEXT) claim[key] = clip(claim[key], 600);

	claim.executionPath = repairSteps(claim.executionPath, 12);

	if (typeof claim.existingGuard === 'string')
		claim.existingGuard = claim.existingGuard.trim() ? clip(claim.existingGuard, 600) : null;
	else if (claim.existingGuard !== null) delete claim.existingGuard;

	f.claim = claim;
}

const SMELLS: ReadonlySet<string> = new Set(READABILITY_SMELLS);

/** "r3" is R3; a ruleId or smell outside the ledger's form or the smell list is null, for the validator to judge. */
function repairQualityFields(f: Record<string, unknown>): void {
	const ruleId = typeof f.ruleId === 'string' ? f.ruleId.trim().toUpperCase() : '';

	f.ruleId = /^R\d+$/.test(ruleId) ? ruleId : null;

	const smell =
		typeof f.smell === 'string'
			? f.smell
					.trim()
					.toLowerCase()
					.replace(/[\s_]+/g, '-')
			: '';

	f.smell = SMELLS.has(smell) ? smell : null;

	if (typeof f.symbol === 'string') f.symbol = f.symbol.trim() ? clip(f.symbol.trim(), 200) : null;
	else if (f.symbol !== null) delete f.symbol;

	f.examples = repairSteps(f.examples, 6);

	f.fix = (Array.isArray(f.fix) ? f.fix : [])
		.filter((edit): edit is Record<string, unknown> => isRecord(edit))
		.filter((edit) => typeof edit.file === 'string' && typeof edit.find === 'string' && edit.find.length > 0)
		.map((edit) => ({
			file: edit.file,
			find: edit.find,
			replace: typeof edit.replace === 'string' ? edit.replace : ''
		}))
		.slice(0, 6);
}

/** Repairs one finding, or drops it when it isn't an object or its severity is only informational. */
function normalizeFinding(item: unknown, defaultCategory: FindingCategory): Record<string, unknown>[] {
	if (!isRecord(item)) return [];

	const f = { ...item };

	f.file ??= f.path ?? f.filePath ?? f.file_path;
	f.body ??= f.description ?? f.explanation ?? f.details ?? f.message;

	if (typeof f.severity === 'string') {
		const severity = f.severity.trim().toLowerCase();

		if (DROPPED_SEVERITIES.has(severity)) return [];
		f.severity = SEVERITY_ALIASES[severity] ?? severity;
	}

	if (typeof f.category !== 'string' || !f.category.trim()) f.category = defaultCategory;

	repairLines(f, true);

	if (Array.isArray(f.evidenceIds))
		f.evidenceIds = f.evidenceIds.filter((id) => typeof id === 'string' && id).slice(0, 12);
	else if (typeof f.evidenceIds === 'string') f.evidenceIds = [f.evidenceIds];

	f.title = clip(f.title, 120);
	f.body = clip(f.body, 2000);
	if (f.questionId !== undefined) f.questionId = briefQuestionId(f.questionId);

	repairClaim(f);
	repairQualityFields(f);

	if (Array.isArray(f.relatedLocations)) {
		f.relatedLocations = f.relatedLocations.slice(0, 20).flatMap((loc) => {
			if (!isRecord(loc)) return [];

			const l = { ...loc };

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
				: isRecord(gap) && typeof gap.hunkId === 'string'
					? [{ ...gap, reason: clip(gap.reason ?? 'not examined', 400) }]
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
 * "High" or "critical" for a severity, `description` for `body`, claim fields
 * beside the claim, a missing `examinedHunks`, an over-long body. Repair what
 * has one obvious meaning before validating, so a sound answer isn't thrown
 * away over formatting. A finding with no category gets the lens's first one.
 * Only an attempted final answer (one with a findings list) is repaired; a
 * bare "message" is commentary, not a finished review. A malformed subagent
 * request is optional, so it is dropped rather than failing the whole answer,
 * and so is a bad `unsettled` or `answered` list.
 */
function normalizeReviewerRaw(raw: unknown, defaultCategory: FindingCategory): unknown {
	if (!isRecord(raw)) return raw;
	if (!Array.isArray(raw.findings)) return raw;

	const out = { ...raw };

	if (typeof out.message !== 'string' && typeof out.summary === 'string') out.message = out.summary;
	if (out.message !== undefined) out.message = clip(out.message, 12000);

	out.findings = (out.findings as unknown[]).slice(0, 30).flatMap((item) => normalizeFinding(item, defaultCategory));

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

	out.unsettled = questionIds(out.unsettled);
	out.answered = normalizeAnswered(out.answered);

	return out;
}

/** "Let me check…", "I'll gather…": the model is describing work it hasn't done yet. */
const ANNOUNCES_WORK =
	/\b(let me|i'll|i will|i'm going to|i am going to|i need to|i'm (?:investigating|checking|looking|reading|gathering)|next,? i|going to (?:check|look|read|inspect|gather|verify))\b/i;

/**
 * Weaker models (often behind vLLM) send the final shape with an empty
 * findings list while announcing what they're about to read, which would end
 * the reviewer before it looked at anything. Push back once. A lens stops
 * here: it starts with its patch and change context, and a lens with nothing
 * in its categories should finish without spending a turn reading.
 */
export function announcedFinal(output: ReviewerOutput): string | null {
	if (output.findings.length || !output.message || !ANNOUNCES_WORK.test(output.message)) return null;

	return 'Your reply says you are still investigating, but it has the final result fields, which would end your review with no findings. If you want to read code, reply with "actions" now. Only send the final result once you have actually finished.';
}

/** A subagent's question reaches past its patch, so it must also read something before it concludes empty. */
export function prematureReviewerFinal(output: ReviewerOutput, state: { retrievals: number }): string | null {
	const announced = announcedFinal(output);

	if (announced || output.findings.length) return announced;

	if (state.retrievals === 0) {
		return 'You concluded with no findings without reading any code beyond the patch. Before concluding, read what the change touches: the full functions it edits, their callers, and anything it removed or replaced. Reply with "actions" now. If you are certain there is nothing more to read, send the same final result again.';
	}

	return null;
}

/**
 * A bug in a branch shows only when something calls it, so the correctness
 * lens, when it can run code, is sent back once if it concludes empty
 * without having run anything.
 */
export function unrunCorrectnessFinal(output: ReviewerOutput, state: { runs: number }): string | null {
	const announced = announcedFinal(output);

	if (announced || output.findings.length || state.runs > 0) return announced;

	return 'You concluded with no findings without running anything. Call each changed function with the empty, zero, boundary and malformed inputs from your procedure in a scratch script or test, and run the tests for this unit. Reply with "actions" now. If nothing here can run, send the same final result again.';
}

export function parseReviewerOutput(
	raw: unknown,
	defaultCategory: FindingCategory = 'correctness'
): ReviewerOutput | null {
	const parsed = reviewerOutputSchema.safeParse(normalizeReviewerRaw(raw, defaultCategory));

	return parsed.success ? parsed.data : null;
}

/**
 * What is left of an answer that kept failing validation once no repair turn
 * remains: the findings that are valid by themselves, with the rest dropped.
 * Null when no finding survives, so one malformed finding never costs the others.
 */
export function salvageReviewerOutput(
	raw: unknown,
	defaultCategory: FindingCategory = 'correctness'
): ReviewerOutput | null {
	const normalized = normalizeReviewerRaw(raw, defaultCategory);

	if (!isRecord(normalized) || !Array.isArray(normalized.findings)) return null;

	const findings = normalized.findings.filter((finding) => reviewerFindingSchema.safeParse(finding).success);
	const parsed = reviewerOutputSchema.safeParse({ ...normalized, findings });

	return parsed.success && findings.length ? parsed.data : null;
}

/** Name the exact fields that are wrong, so the model can fix them instead of guessing. */
export function reviewerValidationError(raw: unknown, defaultCategory: FindingCategory = 'correctness'): string {
	if (!isRecord(raw)) return 'expected one JSON object';

	const parsed = reviewerOutputSchema.safeParse(normalizeReviewerRaw(raw, defaultCategory));

	if (parsed.success) return 'output did not match the required schema';

	return parsed.error.issues
		.slice(0, 6)
		.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
		.join('; ');
}

/** The guided-decoding shape of one finding, with the lens's categories as the only choices. */
function findingResponseSchema(categories: readonly FindingCategory[]): Record<string, unknown> {
	const str = { type: 'string' };
	const line = { type: ['integer', 'null'] };
	const nullableStr = { type: ['string', 'null'] };

	const step = {
		type: 'object',
		properties: { file: str, line: { type: 'integer' }, note: str },
		required: ['file', 'line']
	};

	const claim = {
		type: 'object',
		properties: {
			trigger: str,
			executionPath: { type: 'array', items: step },
			consequence: str,
			violatedContract: str,
			existingGuard: nullableStr
		},
		required: ['trigger', 'executionPath', 'consequence', 'violatedContract']
	};

	return {
		type: 'object',
		properties: {
			title: str,
			file: str,
			line,
			endLine: line,
			severity: { type: 'string', enum: ['high', 'medium', 'low'] },
			category: { type: 'string', enum: categories.length ? [...categories] : [...FINDING_CATEGORIES] },
			symbol: nullableStr,
			ruleId: nullableStr,
			questionId: nullableStr,
			smell: { type: ['string', 'null'], enum: [...READABILITY_SMELLS, null] },
			claim,
			examples: { type: 'array', items: step },
			fix: {
				type: 'array',
				items: {
					type: 'object',
					properties: { file: str, find: str, replace: str },
					required: ['file', 'find', 'replace']
				}
			},
			body: str,
			evidenceIds: { type: 'array', items: str },
			side: { type: 'string', enum: ['old', 'new'] }
		},
		required: ['title', 'file', 'severity', 'category', 'claim', 'body', 'evidenceIds']
	};
}

/**
 * What a reviewer turn may look like, for endpoints with guided decoding:
 * a retrieval request with at least one action, or the final result. On the
 * final turn only the result is allowed. Kept looser than the zod schema:
 * it shapes the reply, and `parseReviewerOutput` still validates it. An empty
 * category list (a subagent) allows every category.
 */
export function reviewerResponseSchema(
	exec: boolean,
	finalTurn: boolean,
	categories: readonly FindingCategory[] = []
): { name: string; schema: Record<string, unknown> } {
	const str = { type: 'string' };
	const strings = { type: 'array', items: str };

	const scope = {
		type: 'array',
		items: { type: 'object', properties: { path: str, hunkIds: strings }, required: ['path', 'hunkIds'] }
	};

	const final = {
		type: 'object',
		properties: {
			message: str,
			findings: { type: 'array', items: findingResponseSchema(categories), maxItems: 30 },
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
			unsettled: strings,
			answered: ANSWERED_RESPONSE,
			recommendedChecks: strings
		},
		required: ['message', 'findings', 'examinedHunks']
	};

	return {
		name: finalTurn ? 'review_result' : 'review_turn',
		schema: finalTurn ? final : { anyOf: [retrievalTurnSchema(exec), final] }
	};
}
