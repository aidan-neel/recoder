import { z } from 'zod';
import type { FindingCategory } from '@recoder/shared';
import type { EvidenceStore } from '../../evidence/evidence.js';
import type { RepoRule } from '../guidelines/ledger/types.js';
import { changedLines, type ChangedLine } from './candidate-repair-anchor.js';
import {
	categoryOptions,
	citableClaims,
	rulesFor,
	type RepairChange,
	type RepairPlan,
	type RepairScope
} from './candidate-repair.js';
import type { CandidateFinding } from './consolidate.js';
import type { IntentClaim } from './intent/types.js';

/** What one repair call may choose from: lines the change added, categories, claims and rules that exist. */
export interface RepairOptions {
	lines: ChangedLine[];
	categories: FindingCategory[];
	claims: IntentClaim[];
	rules: RepoRule[];
}

/** Enough lines for the files a claim walks through, few enough for one short call. */
const MAX_LINE_OPTIONS = 60;

const MAX_EVIDENCE_CHARS = 1500;

/** The changed lines in the candidate's file and in the other changed files its claim cites, nearest a cited line first. */
function lineOptions(candidate: CandidateFinding, scope: RepairScope): ChangedLine[] {
	const steps = [
		{ file: candidate.file, line: candidate.line ?? 0 },
		...(candidate.claim?.executionPath ?? []),
		...(candidate.relatedLocations ?? []).map((location) => ({ file: location.file, line: location.line ?? 0 }))
	];

	const files = [...new Set(steps.map((step) => step.file))];

	const near = (line: ChangedLine) =>
		Math.min(...steps.filter((step) => step.file === line.file).map((step) => Math.abs(step.line - line.line)));

	return files
		.flatMap((file) => changedLines(scope.inventory, file))
		.sort((a, b) => near(a) - near(b))
		.slice(0, MAX_LINE_OPTIONS);
}

/**
 * Why a call could not repair the candidate: a choice the plan left open with
 * nothing to offer for it. Null when every open choice has options, so the call is worth making.
 */
export function nothingToOffer(plan: RepairPlan, options: RepairOptions): string | null {
	for (const choice of plan.open) {
		if (choice.need === 'line' && !options.lines.length) {
			return `${choice.reason}, and no changed line in the files it cites to offer`;
		}

		if (choice.need === 'category' && !options.categories.length && !options.claims.length && !options.rules.length) {
			return `${choice.reason}, and no category, claim or rule to offer`;
		}
	}

	return null;
}

/** The options for what the plan left open; empty lists for what it settled. */
export function repairOptions(candidate: CandidateFinding, plan: RepairPlan, scope: RepairScope): RepairOptions {
	const issues = new Set(plan.open.map((choice) => (choice.need === 'line' ? 'line' : choice.issue)));

	return {
		lines: issues.has('line') ? lineOptions(candidate, scope) : [],
		categories: issues.has('lens') || issues.has('intent') ? categoryOptions(candidate) : [],
		claims: issues.has('intent') ? citableClaims(scope.intent) : [],
		rules: issues.has('rule') ? rulesFor(scope.ledger, candidate.file) : []
	};
}

export const REPAIR_SYSTEM = [
	'You repair one code review finding that failed validation, using only the evidence given.',
	'Choose only among the listed options. Pick a line only when the finding and its evidence show that changed line introduces or carries the defect it describes.',
	'Pick a category, claim or rule only when the finding and its evidence support it. Never invent a path, line, rule or requirement.',
	'When no option is supported, answer null for it.',
	'Answer with JSON: {"file": path of the chosen line or null, "line": its line number or null, "category": string or null, "claimId": string or null, "ruleId": string or null, "reason": "one sentence"}.'
].join('\n');

/** The evidence records the candidate cites, as the call sees them. */
function evidenceBlock(candidate: CandidateFinding, evidence: EvidenceStore): string {
	return (candidate.evidenceIds ?? [])
		.flatMap((id) => {
			const record = evidence.get(id);

			if (!record) return [];

			const where =
				record.kind === 'run' ? `run: ${record.command}` : `${record.path}:${record.startLine}-${record.endLine}`;

			return [`evidenceId=${id} (${where})\n${record.content.slice(0, MAX_EVIDENCE_CHARS)}`];
		})
		.join('\n\n');
}

/** The call's prompt: the finding, why it failed, its evidence and the options. */
export function repairPrompt(
	candidate: CandidateFinding,
	plan: RepairPlan,
	options: RepairOptions,
	evidence: EvidenceStore
): string {
	const finding = {
		title: candidate.title,
		file: candidate.file,
		line: candidate.line,
		category: candidate.category,
		body: candidate.message,
		claim: candidate.claim,
		fix: candidate.fix
	};

	return [
		`Finding:\n${JSON.stringify(finding, null, 1)}`,
		`Why it failed validation: ${plan.open.map((choice) => choice.reason).join('; ')}`,
		`Evidence:\n${evidenceBlock(candidate, evidence) || '(none)'}`,
		options.lines.length
			? `Line options (path:line code):\n${options.lines.map((line) => `${line.file}:${line.line} ${line.text.trim()}`).join('\n')}`
			: '',
		options.categories.length ? `Category options: ${options.categories.join(', ')}` : '',
		options.claims.length
			? `Claim options:\n${options.claims.map((claim) => `${claim.id}: ${claim.text}`).join('\n')}`
			: '',
		options.rules.length ? `Rule options:\n${options.rules.map((rule) => `${rule.id}: ${rule.text}`).join('\n')}` : ''
	]
		.filter(Boolean)
		.join('\n\n');
}

export const repairAnswerSchema = z.object({
	file: z.string().nullable().optional(),
	line: z.number().int().positive().nullable().optional(),
	category: z.string().nullable().optional(),
	claimId: z.string().nullable().optional(),
	ruleId: z.string().nullable().optional(),
	reason: z.string().max(600).default('')
});

export type RepairAnswer = z.infer<typeof repairAnswerSchema>;

/**
 * The offered line the answer names by path and line number; the path may be
 * left out when only one offered line has that number.
 */
function chosenLine(answer: RepairAnswer, lines: ChangedLine[]): ChangedLine | undefined {
	const matches = lines.filter((line) => line.line === answer.line && (!answer.file || line.file === answer.file));

	return matches.length === 1 ? matches[0] : undefined;
}

/**
 * The model's answer as repair changes, checked against what it was offered:
 * a line outside the options, or a category, claim or rule it wasn't shown,
 * makes the whole answer unsupported. So does leaving open anything the plan needs.
 */
export function changesFromAnswer(
	answer: RepairAnswer,
	plan: RepairPlan,
	options: RepairOptions
): RepairChange[] | string {
	const basis = `model: ${answer.reason || 'no reason given'}`;
	const changes: RepairChange[] = [];

	if (options.lines.length) {
		const chosen = chosenLine(answer, options.lines);

		if (!chosen) return 'the model chose no offered line';

		changes.push({ kind: 'anchor', file: chosen.file, line: chosen.line, basis });
	}

	const category = options.categories.find((entry) => entry === answer.category);
	const claim = options.claims.find((entry) => entry.id === answer.claimId);
	const rule = options.rules.find((entry) => entry.id === answer.ruleId);

	if (claim) changes.push({ kind: 'citation', claimId: claim.id, basis });
	else if (category) changes.push({ kind: 'category', category, basis });
	else if (rule) changes.push({ kind: 'rule', ruleId: rule.id, basis });
	else if (options.categories.length || options.claims.length || options.rules.length) {
		return 'the model chose no offered category, claim or rule';
	}

	return [...plan.changes, ...changes];
}
