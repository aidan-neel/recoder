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

/** Remove git's double-quoting around paths containing spaces. */
function unquote(path: string): string {
	return path.startsWith('"') && path.endsWith('"') && path.length >= 2
		? path.slice(1, -1)
		: path;
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
	// Last seen ---/+++ paths. Some producers (plain patches, MR raw diffs)
	// omit `diff --git` headers — these let orphan hunks find their file.
	let pendingOld: string | null = null;
	let pendingNew: string | null = null;

	const pushHunk = () => {
		if (current && hunk) current.hunks.push(hunk);
		hunk = null;
	};

	for (const raw of input.split('\n')) {
		if (raw.startsWith('diff --git ')) {
			pushHunk();
			const parts = raw.split(' ');
			let rawPath = parts[2] ?? 'unknown';
			// Quoted paths (spaces in name): rejoin tokens through the closing quote.
			if (rawPath.startsWith('"')) {
				const collected = [rawPath];
				let i = 3;
				while (!rawPath.endsWith('"') && i < parts.length) {
					rawPath = parts[i];
					collected.push(rawPath);
					i++;
				}
				rawPath = collected.join(' ').replace(/^"|"$/g, '');
			}
			current = blankFile(stripPrefix(rawPath));
			files.push(current);
			pendingOld = null;
			pendingNew = null;
			continue;
		}
		if (raw.startsWith('--- ') || raw.startsWith('+++ ')) {
			const p = raw.slice(4).trim();
			const path = p === '/dev/null' ? null : stripPrefix(unquote(p.split('\t')[0]));
			if (raw.startsWith('--- ')) pendingOld = path;
			else pendingNew = path;
			if (current && current.path === 'unknown' && path) {
				current.path = path;
			}
			continue;
		}
		const m = HUNK_RE.exec(raw);
		if (m) {
			pushHunk();
			if (!current) {
				current = blankFile(pendingNew ?? pendingOld ?? 'unknown');
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

function splitFileLines(text: string): string[] {
	if (text === '') return [];
	const lines = text.split('\n');
	if (lines[lines.length - 1] === '') lines.pop();
	return lines;
}

const MAX_EXPAND_LINES = 8000;

/**
 * Fill hunk gaps with the new-side file so the diff view can show the whole
 * file, not just changed islands. Returns the original file when the text is
 * empty, huge, or already a single covering hunk.
 */
export function expandFileDiff(file: FileDiff, newText: string): FileDiff {
	const newLines = splitFileLines(newText);
	if (newLines.length === 0 || newLines.length > MAX_EXPAND_LINES || file.hunks.length === 0) {
		return file;
	}

	const out: DiffLine[] = [];
	let newCursor = 1;
	let oldCursor = 1;

	for (const hunk of file.hunks) {
		while (newCursor < hunk.newStart && newCursor <= newLines.length) {
			out.push({
				type: 'context',
				oldNo: oldCursor,
				newNo: newCursor,
				text: newLines[newCursor - 1] ?? ''
			});
			newCursor += 1;
			oldCursor += 1;
		}
		oldCursor = hunk.oldStart > 0 ? hunk.oldStart : oldCursor;
		for (const line of hunk.lines) {
			out.push(line);
			if (line.newNo !== null) newCursor = line.newNo + 1;
			if (line.oldNo !== null) oldCursor = line.oldNo + 1;
		}
	}
	while (newCursor <= newLines.length) {
		out.push({
			type: 'context',
			oldNo: oldCursor,
			newNo: newCursor,
			text: newLines[newCursor - 1] ?? ''
		});
		newCursor += 1;
		oldCursor += 1;
	}

	const lastOld = out.reduce((max, line) => (line.oldNo !== null && line.oldNo > max ? line.oldNo : max), 0);
	return {
		...file,
		hunks: [
			{
				header: `@@ -1,${lastOld} +1,${newLines.length} @@`,
				oldStart: 1,
				oldCount: lastOld,
				newStart: 1,
				newCount: newLines.length,
				lines: out
			}
		]
	};
}
