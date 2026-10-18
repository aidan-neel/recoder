import type { DiffHunk } from '@recoder/shared';

/** A Map-backed stand-in for the browser's localStorage or sessionStorage. */
export function memoryStorage(): Storage {
	const items = new Map<string, string>();

	return {
		get length() {
			return items.size;
		},
		key: (index) => [...items.keys()][index] ?? null,
		getItem: (key) => items.get(key) ?? null,
		setItem: (key, value) => void items.set(key, value),
		removeItem: (key) => void items.delete(key),
		clear: () => items.clear()
	};
}

/** A hunk of `count` added lines on the new side, starting at line `start`. */
export function addedHunk(start: number, count: number): DiffHunk {
	return {
		header: `@@ -${start},0 +${start},${count} @@`,
		oldStart: start,
		oldCount: 0,
		newStart: start,
		newCount: count,
		lines: Array.from({ length: count }, (_, i) => ({ type: 'add' as const, oldNo: null, newNo: start + i, text: '' }))
	};
}
