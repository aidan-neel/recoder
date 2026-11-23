import { createRun } from '../../../../src/review/pipeline/harness/context';

/** A semantic patch, unlike the filler lines the harness's size fixtures use. */
export function added(path: string, code: string, start = 1): string {
	const lines = code.split('\n');

	return `diff --git a/${path} b/${path}\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +${start},${lines.length} @@\n${lines.map((line) => `+${line}`).join('\n')}\n`;
}

export const newRun = (diff = added('src/core.ts', 'export const answer = 42;')) =>
	createRun({ diff, sandboxPath: null });
