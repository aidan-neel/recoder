import type { ReviewToolCall } from '@recoder/shared';
import type { FileDiffLine } from '@sivir-ui/svelte/components/file-diff';

export type EvidenceView =
	| { kind: 'diff' | 'file'; file: string; lines: FileDiffLine[] }
	| { kind: 'text'; text: string };

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Unified diff text → rows with old/new line numbers (file headers dropped). */
export function parseUnifiedDiff(text: string): { file: string; lines: FileDiffLine[] } | null {
	let file = '';
	let oldNo = 0;
	let newNo = 0;
	let inHunk = false;
	const lines: FileDiffLine[] = [];
	for (const raw of text.replace(/\n$/, '').split('\n')) {
		const hunk = HUNK.exec(raw);
		if (hunk) {
			oldNo = Number(hunk[1]);
			newNo = Number(hunk[2]);
			inHunk = true;
			continue;
		}
		if (!inHunk) {
			const header = /^\+\+\+ (?:b\/)?(.+)$/.exec(raw) ?? /^--- (?:a\/)?(.+)$/.exec(raw);
			if (header && header[1] !== '/dev/null') file = header[1];
			continue;
		}
		if (raw.startsWith('\\')) continue;
		if (raw.startsWith('+')) lines.push({ type: 'add', newLineNumber: newNo++, content: raw.slice(1) });
		else if (raw.startsWith('-')) lines.push({ type: 'remove', oldLineNumber: oldNo++, content: raw.slice(1) });
		else lines.push({ type: 'context', oldLineNumber: oldNo++, newLineNumber: newNo++, content: raw.slice(1) });
	}
	return lines.length ? { file, lines } : null;
}

/** `12|code` file reads → numbered context rows. */
function parseNumberedFile(text: string): FileDiffLine[] | null {
	const rows = text.replace(/\n$/, '').split('\n');
	const lines: FileDiffLine[] = [];
	for (const row of rows) {
		const match = /^(\d+)\|(.*)$/.exec(row);
		if (!match) return null;
		const n = Number(match[1]);
		lines.push({ type: 'context', oldLineNumber: n, newLineNumber: n, content: match[2] });
	}
	return lines.length ? lines : null;
}

/** How to show a cited tool result: as a diff, a file excerpt, or plain text. */
export function evidenceView(tool: ReviewToolCall): EvidenceView | null {
	const text = tool.result?.content;
	if (!text) return null;
	const input = (tool.input ?? {}) as { action?: string; type?: string; path?: string };
	// Command output is shown as-is: test runners print lines like `--- FAIL`.
	if (input.action === 'run') return { kind: 'text', text };
	const path = typeof input.path === 'string' ? input.path : '';
	const diff = /^(diff --git|--- |@@ )/m.test(text) ? parseUnifiedDiff(text) : null;
	if (diff) return { kind: 'diff', file: diff.file || path, lines: diff.lines };
	const numbered = parseNumberedFile(text);
	if (numbered && path) return { kind: 'file', file: path, lines: numbered };
	return { kind: 'text', text };
}

/** File extension as a highlight.js language id (its aliases cover ts, js, py…). */
export function langForPath(path: string): string {
	const name = path.split('/').at(-1) ?? '';
	return name.includes('.') ? name.split('.').at(-1)!.toLowerCase() : '';
}
