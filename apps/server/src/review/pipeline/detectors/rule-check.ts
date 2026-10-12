import { matchesGlob } from '../../chat/directive.js';
import { ruleAppliesTo } from '../../guidelines/ledger/glob.js';
import { ruleCitation } from '../../guidelines/ledger/ledger.js';
import type { MechanicalCheck, RepoRule, RuleLedger } from '../../guidelines/ledger/types.js';
import type { ReviewInventory } from '../inventory.js';
import { braceLessLines, bracesApply } from './braces.js';
import { clip, type AddedLines } from './changed-lines.js';
import type { DetectorResult } from './types.js';

/** Other breaking lines listed with a forbid-pattern or require-braces result. */
const MAX_RELATED = 10;

/** Added lines longer than this are cut before a rule's pattern runs on them. */
const MAX_TESTED_CHARS = 1000;

/** What the rule-check detector reads besides the ledger. */
export interface RuleCheckInput {
	inventory: ReviewInventory;
	added: AddedLines;
	/** Changed files' text at the PR head; files missing here are skipped by size and brace checks. */
	heads: Map<string, string>;
}

function inScope(rule: RepoRule, glob: string | undefined, path: string): boolean {
	return ruleAppliesTo(rule, path) && (!glob || matchesGlob(path, glob));
}

function ruleResult(rule: RepoRule, file: string, line: number, body: string, evidence: string): DetectorResult {
	return {
		detector: 'rule-check',
		category: 'repo-rule',
		title: `Breaks ${rule.id}: ${clip(rule.text, 70)}`,
		body,
		file,
		line,
		ruleId: rule.id,
		evidence
	};
}

function lineCount(text: string): number {
	return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
}

/** Changed files that grew past the limit; the result sits on the file's first added line, which the diff shows. */
function maxLines(
	rule: RepoRule,
	check: Extract<MechanicalCheck, { kind: 'max-file-lines' }>,
	input: RuleCheckInput
): DetectorResult[] {
	return [...input.added].flatMap(([file, lines]) => {
		const text = input.heads.get(file);
		const entry = input.inventory.files.find((candidate) => candidate.path === file);

		if (text === undefined || !entry || !inScope(rule, check.glob, file)) return [];
		if (entry.status !== 'added' && entry.additions <= entry.deletions) return [];

		const count = lineCount(text);

		if (count <= check.max) return [];

		return [
			ruleResult(
				rule,
				file,
				lines.keys().next().value!,
				`This file is ${count} lines after the change, over the ${check.max}-line limit in ${ruleCitation(rule)}. Split it along a real seam.`,
				`${file} has ${count} lines at the PR head; ${rule.id} allows ${check.max}.`
			)
		];
	});
}

/**
 * One result for a file's breaking lines: the first, with the rest as related
 * locations, so a rule broken many times in one file is one finding.
 */
function perFile(rule: RepoRule, file: string, lines: number[], evidence: string): DetectorResult {
	const [line, ...rest] = lines;

	const more = rest.length
		? ` ${rest.length} more added line${rest.length === 1 ? '' : 's'} in this file break it too.`
		: '';

	return {
		...ruleResult(
			rule,
			file,
			line!,
			`This added line breaks ${rule.id} (${ruleCitation(rule)}): ${rule.text}${more}`,
			evidence
		),
		...(rest.length ? { relatedLocations: rest.slice(0, MAX_RELATED).map((other) => ({ file, line: other })) } : {})
	};
}

/** One result per file: the first added line that matches, with the rest as related locations. */
function forbidden(
	rule: RepoRule,
	check: Extract<MechanicalCheck, { kind: 'forbid-pattern' }>,
	input: RuleCheckInput
): DetectorResult[] {
	const pattern = new RegExp(check.pattern);

	return [...input.added].flatMap(([file, lines]) => {
		if (!inScope(rule, check.glob, file)) return [];

		const hits = [...lines].filter(([, text]) => pattern.test(text.slice(0, MAX_TESTED_CHARS)));

		if (!hits.length) return [];

		const [line, text] = hits[0]!;

		return [
			perFile(
				rule,
				file,
				hits.map(([hit]) => hit),
				`${file}:${line} matches /${check.pattern}/: ${clip(text, 200)}`
			)
		];
	});
}

/**
 * Added control-flow statements whose body is not a `{ }` block, one result
 * per file, read from the file's text at the PR head. Files without it, or in
 * a language the check can't parse, are skipped.
 */
async function braceless(
	rule: RepoRule,
	check: Extract<MechanicalCheck, { kind: 'require-braces' }>,
	input: RuleCheckInput
): Promise<DetectorResult[]> {
	const files = [...input.added].filter(([file]) => bracesApply(file) && inScope(rule, check.glob, file));

	const results = await Promise.all(
		files.map(async ([file, lines]) => {
			const text = input.heads.get(file);

			if (text === undefined) return [];

			const hits = await braceLessLines(file, text, lines);

			if (!hits.length) return [];

			const source = lines.get(hits[0]!) ?? '';

			return [
				perFile(rule, file, hits, `${file}:${hits[0]} has a control-flow body without braces: ${clip(source, 200)}`)
			];
		})
	);

	return results.flat();
}

/** Added files in the wrong place, anchored on their first line. */
function misplaced(
	rule: RepoRule,
	check: Extract<MechanicalCheck, { kind: 'path-pattern' }>,
	input: RuleCheckInput
): DetectorResult[] {
	return input.inventory.files
		.filter(
			(file) =>
				file.status === 'added' &&
				input.added.has(file.path) &&
				inScope(rule, check.files, file.path) &&
				!matchesGlob(file.path, check.mustMatch)
		)
		.map((file) =>
			ruleResult(
				rule,
				file.path,
				1,
				`This new file breaks ${rule.id} (${ruleCitation(rule)}): ${rule.text}`,
				`${file.path} matches ${check.files} but not ${check.mustMatch}.`
			)
		);
}

function runCheck(
	rule: RepoRule,
	check: MechanicalCheck,
	input: RuleCheckInput
): DetectorResult[] | Promise<DetectorResult[]> {
	if (check.kind === 'max-file-lines') return maxLines(rule, check, input);
	if (check.kind === 'forbid-pattern') return forbidden(rule, check, input);
	if (check.kind === 'require-braces') return braceless(rule, check, input);

	return misplaced(rule, check, input);
}

/**
 * Every mechanical ledger rule run against the diff: added lines for patterns
 * and braces, changed files for size and place. Results keep rule order.
 */
export async function ruleCheckResults(ledger: RuleLedger | null, input: RuleCheckInput): Promise<DetectorResult[]> {
	const results = await Promise.all(
		(ledger?.rules ?? []).map((rule) => (rule.check ? runCheck(rule, rule.check, input) : []))
	);

	return results.flat();
}
