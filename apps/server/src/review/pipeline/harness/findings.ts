import { createHash } from 'node:crypto';
import { findingKind, type DiffLine, type Finding } from '@recoder/shared';
import type { ReviewInventory } from '../inventory.js';

/** What a finding's identity is made of: never its wording or exact line, so a re-run finds the same id. */
interface FingerprintParts {
	file: string;
	category: string;
	ruleId?: string;
	smell?: string;
	/** The enclosing symbol's qualified name, from the change model. */
	symbol?: string;
	/** The inventory hunk holding the line, when no symbol encloses it. */
	hunkId?: string;
	/** The text of the line the finding sits on, so two issues in one symbol keep apart. */
	anchor?: string;
}

/** A short stable hash of `text`. */
function hash(text: string): string {
	return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** Collapses whitespace so a re-indented line keeps the same fingerprint. */
function normalizeAnchor(text: string): string {
	return text
		.split('\n')
		.map((line) => line.trim().replace(/\s+/g, ' '))
		.filter(Boolean)
		.join('\n');
}

/** Every bug category shares one class; a quality category is its own. */
function identityKind(category: string): string {
	return findingKind(category) === 'bug' ? 'bug' : category;
}

/**
 * A stable id for a finding: its file, its class, the rule or smell it names,
 * the symbol that encloses it (the hunk when none does), and the text of its
 * line. Wording, line numbers and the other findings of the run leave it
 * unchanged. Every bug category shares one class, because two lenses often
 * file one bug under different categories; quality categories each keep their
 * own. Without `anchor` it is the merge key, which nearby reports share.
 */
export function fingerprintFinding(parts: FingerprintParts): string {
	const kind = identityKind(parts.category);
	const anchor = parts.anchor === undefined ? [] : [normalizeAnchor(parts.anchor)];

	return hash(
		[parts.file, kind, parts.ruleId ?? parts.smell ?? '', parts.symbol ?? parts.hunkId ?? '', ...anchor].join('\n')
	);
}

/**
 * What a person's dismissal is remembered by: the fingerprint's file, class,
 * rule or smell, symbol and line text, but never the hunk, whose id holds line
 * positions and so changes whenever code above it moves. Review and dismissal
 * both compute it from the finding as stored.
 */
export function dismissalFingerprint(parts: Omit<FingerprintParts, 'hunkId'> & { anchor: string }): string {
	return hash(
		[
			parts.file,
			identityKind(parts.category),
			parts.ruleId ?? parts.smell ?? '',
			parts.symbol ?? '',
			normalizeAnchor(parts.anchor)
		].join('\n')
	);
}

/** Splits a fingerprint shared by two separate places, using what tells them apart. */
export function refineFingerprint(fingerprint: string, place: string): string {
	return hash(`${fingerprint}\n${place}`);
}

/** The id of the inventory hunk that holds `line` on `side` of `file`. */
export function hunkAt(
	inventory: ReviewInventory,
	file: string,
	line: number | undefined,
	side: 'old' | 'new'
): string | undefined {
	if (!line) return undefined;

	const entry = inventory.files.find((candidate) => candidate.path === file);

	const hunk = entry?.hunks.find((candidate) => {
		const start = side === 'old' ? candidate.oldStart : candidate.newStart;
		const count = side === 'old' ? candidate.oldCount : candidate.newCount;

		return line >= start && line < start + Math.max(count, 1);
	});

	return hunk?.id;
}

function numberOn(line: DiffLine, side: 'old' | 'new'): number | null {
	return side === 'old' ? line.oldNo : line.newNo;
}

function squash(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

/** The backticked code in `texts`, three characters or longer, longest first. */
function quotedCode(texts: string[]): string[] {
	const quotes = texts.flatMap((text) => [...text.matchAll(/`([^`\n]{3,})`/g)].map((match) => squash(match[1])));

	return [...new Set(quotes)].sort((a, b) => b.length - a.length);
}

/**
 * Moves a finding onto the line holding the code it quotes. Lenses often land
 * a few lines off the expression they describe; snapping puts every report of
 * one expression on one line, so it merges and fingerprints the same. The
 * longest quote that names a line decides: the one hunk line holding it, or
 * the reported line when several do and it is one of them.
 */
export function snapToQuote(
	inventory: ReviewInventory,
	file: string,
	line: number | undefined,
	side: 'old' | 'new',
	texts: string[]
): number | undefined {
	if (!line) return line;

	const lines = inventory.diffs
		.find((entry) => entry.path === file)
		?.hunks.find((hunk) => hunk.lines.some((candidate) => numberOn(candidate, side) === line))
		?.lines.filter((candidate) => numberOn(candidate, side) !== null);

	if (!lines) return line;

	for (const quote of quotedCode(texts)) {
		const holding = lines.filter((candidate) => squash(candidate.text).includes(quote));

		if (holding.length === 1) return numberOn(holding[0], side) ?? line;
		if (holding.some((candidate) => numberOn(candidate, side) === line)) return line;
	}

	return line;
}

/** The text of the one line a finding sits on; empty for a finding without a line. */
export function lineAnchor(
	inventory: ReviewInventory,
	file: string,
	line: number | undefined,
	side: 'old' | 'new'
): string {
	return line ? anchorFn(inventory)(file, line, line, side) : '';
}

/** Looks up the diff text on one side of a file between two line numbers. */
function anchorFn(inventory: ReviewInventory) {
	return (file: string, start: number, end: number, side: 'old' | 'new'): string => {
		const diff = inventory.diffs.find((entry) => entry.path === file);

		if (!diff) return '';

		const out: string[] = [];

		for (const hunk of diff.hunks) {
			for (const line of hunk.lines) {
				const no = side === 'old' ? line.oldNo : line.newNo;

				if (no !== null && no >= start && no <= end) out.push(line.text);
			}
		}

		return out.join('\n');
	};
}

/** Findings not seen in an earlier review, deduplicated by fingerprint; unfingerprinted ones are suppressed. */
export function filterNewFindings(
	current: Finding[],
	previousFingerprints: Set<string>
): { fresh: Finding[]; suppressed: number } {
	const seen = new Set<string>();
	const fresh: Finding[] = [];
	let suppressed = 0;

	for (const finding of current) {
		const fp = finding.fingerprint;

		if (!fp || previousFingerprints.has(fp) || seen.has(fp)) {
			suppressed++;
			continue;
		}

		seen.add(fp);
		fresh.push(finding);
	}

	return { fresh, suppressed };
}
