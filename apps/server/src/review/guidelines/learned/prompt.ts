import { clip } from '../../pipeline/detectors/changed-lines.js';
import { UNTRUSTED_PREFIX } from '../../pipeline/prompts.js';
import type { Dismissal } from './dismissals.js';

/** Dismissals a reviewer is shown at most. */
const MAX_LISTED = 8;
const MAX_TITLE_CHARS = 120;
const MAX_REASON_CHARS = 200;

/**
 * The findings people dismissed in this repository, on the files of a unit,
 * newest first. Titles and reasons are written by people and models, so they
 * are clipped and marked as data. Empty when none touch the unit's files.
 */
export function dismissalsBlock(dismissals: Dismissal[], paths: string[]): string {
	const files = new Set(paths);
	const relevant = dismissals.filter((dismissal) => files.has(dismissal.file)).slice(0, MAX_LISTED);

	if (!relevant.length) return '';

	const lines = relevant.map((dismissal) => {
		const reason = dismissal.reason ? `: ${clip(dismissal.reason, MAX_REASON_CHARS)}` : '';

		return `- ${dismissal.file}: ${clip(dismissal.title, MAX_TITLE_CHARS)}${reason}`;
	});

	return `${UNTRUSTED_PREFIX}People dismissed these findings in this repository before. Do not report the same thing again unless the code now differs:\n${lines.join('\n')}`;
}
