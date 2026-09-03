/**
 * Minimal unified-diff parser: `diff --git` output → renderable file diffs.
 * Lives in shared so the server pipeline and the web diff view use one implementation.
 */

export type DiffLineType = 'context' | 'add' | 'del';

export interface DiffLine {
	type: DiffLineType;
	oldNo: number | null;
	newNo: number | null;
	text: string;
}

export interface DiffHunk {
	header: string;
	oldStart: number;
	oldCount: number;
	newStart: number;
	newCount: number;
	lines: DiffLine[];
}

export interface FileDiff {
	/** Display path, e.g. `src/rate-limit/limiter.ts`. */
	path: string;
	additions: number;
	deletions: number;
	hunks: DiffHunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

function stripPrefix(path: string): string {
	return path.replace(/^[ab]\//, '');
}

function blankFile(path: string): FileDiff {
	return { path, additions: 0, deletions: 0, hunks: [] };
}

export function parseUnifiedDiff(input: string): FileDiff[] {
	const files: FileDiff[] = [];
	let current: FileDiff | null = null;
	let hunk: DiffHunk | null = null;
	let oldNo = 0;
	let newNo = 0;

	const pushHunk = () => {
		if (current && hunk) current.hunks.push(hunk);
		hunk = null;
	};

	for (const raw of input.split('\n')) {
		if (raw.startsWith('diff --git ')) {
			pushHunk();
			const parts = raw.split(' ');
			current = blankFile(stripPrefix(parts[2] ?? 'unknown'));
			files.push(current);
			continue;
		}
		if (raw.startsWith('--- ') || raw.startsWith('+++ ')) {
			if (current && current.path === 'unknown') {
				const p = raw.slice(4).trim();
				if (p !== '/dev/null') current.path = stripPrefix(p);
			}
			continue;
		}
		const m = HUNK_RE.exec(raw);
		if (m) {
			pushHunk();
			if (!current) {
				current = blankFile('unknown');
				files.push(current);
			}
			oldNo = Number(m[1]);
			newNo = Number(m[3]);
			hunk = {
				header: raw,
				oldStart: oldNo,
				oldCount: Number(m[2] ?? '1'),
				newStart: newNo,
				newCount: Number(m[4] ?? '1'),
				lines: []
			};
			continue;
		}
		if (!hunk || !current) continue;
		if (raw.startsWith('\\')) continue; // "\ No newline at end of file"

		const marker = raw[0] ?? ' ';
		const text = raw.slice(1);
		if (marker === '-') {
			hunk.lines.push({ type: 'del', oldNo: oldNo++, newNo: null, text });
			current.deletions++;
		} else if (marker === '+') {
			hunk.lines.push({ type: 'add', oldNo: null, newNo: newNo++, text });
			current.additions++;
		} else {
			hunk.lines.push({ type: 'context', oldNo: oldNo++, newNo: newNo++, text: marker === ' ' ? text : raw });
		}
	}
	pushHunk();
	return files.filter((f) => f.hunks.length > 0);
}
