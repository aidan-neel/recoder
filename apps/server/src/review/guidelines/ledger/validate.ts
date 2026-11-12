import { RULE_LEVELS, type RuleLevel } from '@recoder/shared';
import { z } from 'zod';
import { cleanGlob, effectiveRuleScope } from './glob.js';
import { compareSourcePrecedence, resolveRulePrecedence } from './precedence.js';
import type { LedgerSource } from './sources.js';
import type { MechanicalCheck, RepoRule, RuleLedger } from './types.js';

const MAX_RULES = 80;
const MAX_RULE_CHARS = 300;
const MAX_VERBATIM_CHARS = 1200;
const MAX_PATTERN_CHARS = 200;
const MAX_EXCEPTIONS = 8;
const MAX_EXCEPTION_CHARS = 240;
const MIN_SUBCLAUSE_CHARS = 6;

const ADVISORY_CUE =
	/\b(?:prefer\b|consider\b|try\s+to\b|aim\s+to\b|ideally\b|when(?:ever)?\s+(?:practical|possible|reasonable)|where\s+(?:practical|possible)|rule\s+of\s+thumb|optional(?:ly)?|encouraged|recommended|nice\s+to\s+have|generally\b|usually\b)/i;

const MANDATORY_CUE = /\b(?:must\b|never\b|always\b|forbidden\b|prohibited\b|required\b|do\s+not\b|don't\b|shall\b)\b/i;
const INLINE_EXCEPTION_RE = /\b(?:except(?:\s+(?:when|for|in|where|if))?|unless)\s+([^.;\n)]+)/gi;
const ADJACENT_EXCEPTION_RE = /^\s+(?:[-*+]\s*)?(?:exceptions?|except|unless)\b[:\s-]*(.+)$/i;

/** The model's reply; checks stay loose here so one bad check drops only itself, never the rule or the reply. */
export const ledgerReplySchema = z.object({
	message: z.string().max(4000).optional(),
	rules: z.array(
		z.object({
			text: z.string(),
			restatement: z.string().nullish(),
			source: z.string(),
			line: z.number().nullish(),
			endLine: z.number().nullish(),
			level: z.enum(RULE_LEVELS).nullish(),
			appliesTo: z.string().nullish(),
			exceptions: z.array(z.string()).nullish(),
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

function sourceLines(source: LedgerSource): string[] {
	const normalized = source.text.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');

	if (normalized.endsWith('\n')) lines.pop();

	return lines;
}

function stripBullet(text: string): string {
	return text.replace(/^(?:[-*+]|\d+\.)\s+/, '');
}

function locateQuote(quote: string, sourceText: string): { line: number; endLine: number } | undefined {
	if (quote.length < MIN_SUBCLAUSE_CHARS) return undefined;

	const normalized = sourceText.replace(/\r\n/g, '\n');
	const offset = normalized.indexOf(quote);

	if (offset < 0) return undefined;

	const line = normalized.slice(0, offset).split('\n').length;
	const endLine = line + quote.split('\n').length - 1;

	return { line, endLine };
}

function validLine(line: number | null | undefined, totalLines: number): number | undefined {
	if (!line || !Number.isInteger(line) || line < 1 || line > totalLines) return undefined;

	return line;
}

interface ExtractedText {
	text: string;
	verbatim?: false;
	restatement: string;
	line?: number;
	endLine?: number;
}

function collapseWhitespace(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

function verifiedSpanText(quote: string, rawSpan: string, stripped: string): string | null {
	if (!quote) return null;
	if (quote === stripped || quote === rawSpan) return quote;

	const collapsedQuote = collapseWhitespace(quote);

	if (collapsedQuote === collapseWhitespace(stripped)) return stripped;
	if (collapsedQuote === collapseWhitespace(rawSpan)) return rawSpan;
	if (quote.length < MIN_SUBCLAUSE_CHARS) return null;
	if (rawSpan.includes(quote) || collapseWhitespace(rawSpan).includes(collapsedQuote)) return quote;

	return null;
}

function extractRuleText(raw: RawRule, source: LedgerSource, lines: string[]): ExtractedText | null {
	const quote = raw.text.replace(/\r\n/g, '\n').trim();
	const explicitRestatement = raw.restatement ? collapseWhitespace(raw.restatement) : '';
	const restatement = (explicitRestatement || collapseWhitespace(quote)).slice(0, MAX_RULE_CHARS);

	if (!restatement) return null;

	const line = validLine(raw.line, lines.length);
	let endLine = line !== undefined ? (validLine(raw.endLine, lines.length) ?? line) : undefined;

	if (line !== undefined && endLine !== undefined && endLine < line) endLine = line;

	if (line === undefined && quote) {
		const located = locateQuote(quote, source.text);

		if (located) {
			return {
				text: quote.slice(0, MAX_VERBATIM_CHARS),
				restatement,
				line: located.line,
				endLine: located.endLine
			};
		}

		return { text: '', verbatim: false, restatement };
	}

	if (line !== undefined && endLine !== undefined) {
		const quoteSpan = quote.split('\n').length;

		if (raw.endLine === undefined || raw.endLine === null) {
			const candidateEnd = Math.min(lines.length, line + quoteSpan - 1);

			const candidateRaw = lines
				.slice(line - 1, candidateEnd)
				.join('\n')
				.trim();

			if (quoteSpan > 1 && candidateRaw.includes(quote)) endLine = candidateEnd;
		}

		const rawSpan = lines
			.slice(line - 1, endLine)
			.join('\n')
			.trim();

		const matched = verifiedSpanText(quote, rawSpan, stripBullet(rawSpan));

		if (matched) {
			const text = matched.slice(0, MAX_VERBATIM_CHARS);

			return text ? { text, restatement, line, endLine } : null;
		}

		const relocated = quote ? locateQuote(quote, source.text) : undefined;

		if (relocated) {
			return {
				text: quote.slice(0, MAX_VERBATIM_CHARS),
				restatement,
				line: relocated.line,
				endLine: relocated.endLine
			};
		}

		return { text: '', verbatim: false, restatement, line, endLine };
	}

	return { text: '', verbatim: false, restatement };
}

function extractExceptions(
	rawExceptions: string[] | null | undefined,
	ruleText: string,
	lines: string[],
	endLine: number | undefined
): string[] | undefined {
	const collected: string[] = [];

	const add = (item: string) => {
		const cleaned = collapseWhitespace(item).slice(0, MAX_EXCEPTION_CHARS);

		if (!cleaned || collected.length >= MAX_EXCEPTIONS) return;

		if (!collected.some((existing) => existing.toLowerCase() === cleaned.toLowerCase())) {
			collected.push(cleaned);
		}
	};

	for (const item of rawExceptions ?? []) add(item);

	if (!collected.length) {
		for (const match of ruleText.matchAll(INLINE_EXCEPTION_RE)) {
			if (match[1]) add(match[1]);
		}
	}

	if (endLine !== undefined) {
		for (let idx = endLine; idx < lines.length; idx++) {
			const nextLine = lines[idx];
			const match = ADJACENT_EXCEPTION_RE.exec(nextLine);

			if (!match?.[1]) break;
			add(match[1]);
		}
	}

	return collected.length ? collected : undefined;
}

function classifyRuleLevel(
	explicit: RuleLevel | null | undefined,
	verbatimText: string,
	restatement: string
): RuleLevel {
	if (explicit === 'mandatory' || explicit === 'advisory') return explicit;

	const combined = `${verbatimText} ${restatement}`;

	if (ADVISORY_CUE.test(combined) && !MANDATORY_CUE.test(combined)) return 'advisory';

	return 'mandatory';
}

interface PlacedRule {
	rule: Omit<RepoRule, 'id'>;
	sourceIndex: number;
	order: number;
}

function placeRule(raw: RawRule, order: number, sources: LedgerSource[]): PlacedRule | null {
	const sourceIndex = sources.findIndex((source) => source.path === raw.source.trim());

	if (sourceIndex < 0) return null;

	const source = sources[sourceIndex];
	const lines = sourceLines(source);
	const extracted = extractRuleText(raw, source, lines);

	if (!extracted) return null;

	const isVerbatim = extracted.verbatim !== false;

	const exceptions = extractExceptions(
		raw.exceptions,
		isVerbatim ? extracted.text : extracted.restatement,
		lines,
		isVerbatim ? extracted.endLine : undefined
	);

	const level = classifyRuleLevel(raw.level, extracted.text, extracted.restatement);
	const appliesTo = cleanGlob(raw.appliesTo);
	const check = isVerbatim && level === 'mandatory' && !exceptions ? validCheck(raw.check) : undefined;

	return {
		rule: {
			text: extracted.text,
			...(!isVerbatim ? { verbatim: false } : {}),
			restatement: extracted.restatement,
			level,
			source: {
				path: source.path,
				...(extracted.line !== undefined ? { line: extracted.line, endLine: extracted.endLine ?? extracted.line } : {}),
				...(source.revision ? { revision: source.revision } : {})
			},
			...(appliesTo ? { appliesTo } : {}),
			...(exceptions ? { exceptions } : {}),
			...(check ? { check } : {})
		},
		sourceIndex,
		order
	};
}

/**
 * What makes two entries the same rule. A verbatim rule is its scope and its quoted words wherever they are written,
 * so a rule repeated in two files merges into one. A rule with no verified quote is only the model's restatement, so
 * the place it cites is part of the key and two restated rules never merge by chance.
 */
function dedupeKey(entry: PlacedRule): string {
	const scope = effectiveRuleScope(entry.rule) ?? '*';

	if (entry.rule.verbatim !== false) return `${scope}\0${collapseWhitespace(entry.rule.text).toLowerCase()}`;

	const { path, line, endLine } = entry.rule.source;
	const wording = collapseWhitespace(entry.rule.restatement ?? '').toLowerCase();

	return `${scope}\0${path}:${line ?? ''}:${endLine ?? ''}\0${wording}`;
}

function dedupeRules(entries: PlacedRule[]): PlacedRule[] {
	const byKey = new Map<string, PlacedRule>();

	for (const entry of entries) {
		const key = dedupeKey(entry);
		const held = byKey.get(key);

		if (!held || compareSourcePrecedence(entry.rule.source.path, held.rule.source.path) < 0) {
			byKey.set(key, entry);
		}
	}

	return [...byKey.values()];
}

/**
 * The model's rules as a ledger: rules citing an unknown source or with no
 * text are dropped, verbatim source wording and line ranges are anchored to
 * the source file, repeats are merged keeping the higher-precedence source,
 * ids `R1..Rn` follow source order, and conflicting rule files are resolved by precedence.
 */
export function toLedger(reply: LedgerReply, sources: LedgerSource[], sourcesHash: string): RuleLedger {
	const placed = dedupeRules(
		reply.rules
			.map((raw, order) => placeRule(raw, order, sources))
			.filter((entry): entry is PlacedRule => entry !== null)
	);

	placed.sort(
		(a, b) =>
			a.sourceIndex - b.sourceIndex ||
			(a.rule.source.line ?? Number.MAX_SAFE_INTEGER) - (b.rule.source.line ?? Number.MAX_SAFE_INTEGER) ||
			a.order - b.order
	);

	const numbered: RepoRule[] = placed.slice(0, MAX_RULES).map((entry, index) => ({
		id: `R${index + 1}`,
		...entry.rule
	}));

	return { rules: resolveRulePrecedence(numbered), sourcesHash };
}
