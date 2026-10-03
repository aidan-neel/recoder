import { createHash } from 'node:crypto';
import type { Finding } from '@recoder/shared';
import type { ReviewInventory } from '../inventory.js';

/** Collapses whitespace so a re-indented line keeps the same fingerprint. */
function normalizeAnchor(text: string): string {
	return text
		.split('\n')
		.map((line) => line.trim().replace(/\s+/g, ' '))
		.filter(Boolean)
		.join('\n');
}

/** A stable id for a finding, from its file, category and the code it points at. */
export function fingerprintFinding(file: string, category: string, anchorText: string): string {
	return createHash('sha256')
		.update(`${file}\n${category}\n${normalizeAnchor(anchorText)}`)
		.digest('hex')
		.slice(0, 16);
}

/** Looks up the diff text on one side of a file between two line numbers. */
export function anchorFn(inventory: ReviewInventory) {
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
