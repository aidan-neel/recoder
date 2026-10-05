import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serverDataDir } from '../../../util/data-dir.js';

/** A finding a person dismissed, remembered so a later review of the same repository does not report it again. */
export interface Dismissal {
	repoId: string;
	/** What the finding is matched by in later reviews (`dismissalFingerprint`); it holds no line number. */
	fingerprint: string;
	file: string;
	category: string;
	title: string;
	/** Why the person dismissed it, when they said. */
	reason?: string;
	dismissedAt: string;
}

/** The newest dismissals kept for each repository. */
export const MAX_DISMISSALS_PER_REPO = 200;

type Table = Record<string, Dismissal[]>;

function tableFile(): string {
	return join(serverDataDir(), 'dismissed-findings.json');
}

/** The saved table; a missing or unreadable file reads as empty, since losing it only means findings may repeat. */
function readTable(): Table {
	try {
		const parsed: unknown = JSON.parse(readFileSync(tableFile(), 'utf8'));

		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Table) : {};
	} catch {
		return {};
	}
}

/** Writes through a temp file, so a crash never leaves half a table. */
function writeTable(table: Table): void {
	const file = tableFile();
	const temp = `${file}.${process.pid}.tmp`;

	writeFileSync(temp, JSON.stringify(table));
	renameSync(temp, file);
}

/** A repository's dismissals, newest first. */
export function listDismissals(repoId: string): Dismissal[] {
	return readTable()[repoId] ?? [];
}

/** Remembers a dismissal as the newest of its repository; dismissing the same finding again replaces it. */
export function recordDismissal(dismissal: Dismissal): void {
	const table = readTable();
	const others = (table[dismissal.repoId] ?? []).filter((held) => held.fingerprint !== dismissal.fingerprint);

	table[dismissal.repoId] = [dismissal, ...others].slice(0, MAX_DISMISSALS_PER_REPO);
	writeTable(table);
}

/** Forgets a dismissal; false when none was held. */
export function removeDismissal(repoId: string, fingerprint: string): boolean {
	const table = readTable();
	const held = table[repoId] ?? [];
	const kept = held.filter((dismissal) => dismissal.fingerprint !== fingerprint);

	if (kept.length === held.length) return false;

	table[repoId] = kept;
	writeTable(table);

	return true;
}
