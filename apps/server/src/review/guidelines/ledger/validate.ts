import { z } from 'zod';
import { cleanGlob } from './glob.js';
import type { LedgerSource } from './sources.js';
import type { MechanicalCheck, RepoRule, RuleLedger } from './types.js';

const MAX_RULES = 80;
const MAX_RULE_CHARS = 300;
const MAX_PATTERN_CHARS = 200;

/** The model's reply; checks stay loose here so one bad check drops only itself, never the rule or the reply. */
export const ledgerReplySchema = z.object({
	message: z.string().max(4000).optional(),
	rules: z.array(
		z.object({
			text: z.string(),
			source: z.string(),
			line: z.number().nullish(),
			appliesTo: z.string().nullish(),
			check: z.unknown().optional()
		})
	)
});

export type LedgerReply = z.infer<typeof ledgerReplySchema>;

type RawRule = LedgerReply['rules'][number];

const checkSchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('max-file-lines'),
		max: z.number().int().min(1).max(100_000),
		glob: z.string().nullish()
	}),
	z.object({ kind: z.literal('forbid-pattern'), pattern: z.string().min(1), glob: z.string().nullish() }),
	z.object({ kind: z.literal('path-pattern'), files: z.string(), mustMatch: z.string() }),
	z.object({ kind: z.literal('require-braces'), glob: z.string().nullish() })
]);

/**
 * A pattern the forbid-pattern detector can run: short, compiles, and does not
 * match an empty line (which would flag every added line).
 */
function usablePattern(pattern: string): boolean {
	if (pattern.length > MAX_PATTERN_CHARS) return false;

	try {
		return !new RegExp(pattern).test('');
	} catch {
		return false;
	}
}

/** The check in the shape the detectors run, or undefined when it is malformed or can't run. */
function validCheck(raw: unknown): MechanicalCheck | undefined {
	const parsed = checkSchema.safeParse(raw);

	if (!parsed.success) return undefined;

	const check = parsed.data;

	if (check.kind === 'max-file-lines') return { kind: check.kind, max: check.max, glob: cleanGlob(check.glob) };

	if (check.kind === 'forbid-pattern')
		return usablePattern(check.pattern)
			? { kind: check.kind, pattern: check.pattern, glob: cleanGlob(check.glob) }
			: undefined;

	if (check.kind === 'require-braces') return { kind: check.kind, glob: cleanGlob(check.glob) };

	const files = cleanGlob(check.files);
	const mustMatch = cleanGlob(check.mustMatch);

	return files && mustMatch ? { kind: check.kind, files, mustMatch } : undefined;
}

/** The line a rule cites, when it is a real line of its source. */
function citedLine(line: number | null | undefined, source: LedgerSource): number | undefined {
	if (!line || !Number.isInteger(line)) return undefined;

	return line <= source.text.split('\n').length ? line : undefined;
}

/** A rule with an index into `sources`, before ids are assigned. */
interface PlacedRule {
	rule: Omit<RepoRule, 'id'>;
	sourceIndex: number;
	order: number;
}

function placeRule(raw: RawRule, order: number, sources: LedgerSource[]): PlacedRule | null {
	const sourceIndex = sources.findIndex((source) => source.path === raw.source.trim());
	const text = raw.text.replace(/\s+/g, ' ').trim().slice(0, MAX_RULE_CHARS);

	if (sourceIndex < 0 || !text) return null;

	const line = citedLine(raw.line, sources[sourceIndex]);
	const appliesTo = cleanGlob(raw.appliesTo);
	const check = validCheck(raw.check);

	return {
		rule: {
			text,
			source: { path: sources[sourceIndex].path, ...(line ? { line } : {}) },
			...(appliesTo ? { appliesTo } : {}),
			...(check ? { check } : {})
		},
		sourceIndex,
		order
	};
}

/**
 * The model's rules as a ledger: rules citing an unknown source or with no
 * text are dropped, repeats are merged, and ids `R1..Rn` follow source order
 * (file, then cited line), never the model's order.
 */
export function toLedger(reply: LedgerReply, sources: LedgerSource[], sourcesHash: string): RuleLedger {
	const seen = new Set<string>();

	const placed = reply.rules
		.map((raw, order) => placeRule(raw, order, sources))
		.filter((entry): entry is PlacedRule => {
			if (!entry) return false;

			const key = entry.rule.text.toLowerCase();

			if (seen.has(key)) return false;

			seen.add(key);

			return true;
		});

	placed.sort(
		(a, b) =>
			a.sourceIndex - b.sourceIndex ||
			(a.rule.source.line ?? Number.MAX_SAFE_INTEGER) - (b.rule.source.line ?? Number.MAX_SAFE_INTEGER) ||
			a.order - b.order
	);

	const rules = placed.slice(0, MAX_RULES).map((entry, index) => ({ id: `R${index + 1}`, ...entry.rule }));

	return { rules, sourcesHash };
}
