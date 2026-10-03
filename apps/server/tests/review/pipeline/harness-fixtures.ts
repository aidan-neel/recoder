import { afterEach } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { resetLlmLimiter } from '../../../src/models/llm';
import { getStoredSettings, setReviewOverrides } from '../../../src/review/session/review-settings';
import { git } from '../../helpers/git';

export const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new
`;

export const HUNK = 'src/a.ts:1,1:1,1';

/** A new file of `lines` 100-character lines, as one diff section. */
export function addedFile(path: string, lines: number): string {
	const body = Array.from({ length: lines }, (_, index) => `+${String(index).padEnd(99, 'x')}`).join('\n');

	return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines} @@\n${body}\n`;
}

/**
 * Two files in separate folders, each about 14,000 patch characters, so the
 * change is cut into two units: `unit-1` is `src/a.ts`, `unit-2` is `tests/b.ts`.
 */
export const TWO_UNIT_DIFF = addedFile('src/a.ts', 140) + addedFile('tests/b.ts', 140);

/** An empty reviewer answer that read nothing; the agent loop sends it back once before accepting it. */
export const NOTHING = {
	findings: [],
	examinedHunks: [HUNK],
	gaps: [],
	blockers: [],
	subagents: [],
	recommendedChecks: []
};

/** A consolidation answer that keeps nothing. */
export const KEEP_NONE = { keep: [], merge: [], reject: [], recommendedChecks: [] };

/** A reviewer finding on line 1 of `src/a.ts`. */
export const finding = (body: string, severity = 'medium') => ({
	file: 'src/a.ts',
	line: 1,
	severity,
	category: 'bug',
	body,
	evidenceIds: []
});

/** A chat completion whose message content is `body` as JSON. */
export function modelReply(body: unknown): Response {
	return Response.json({ choices: [{ message: { content: JSON.stringify(body) } }] });
}

/** The request's messages, read from a stubbed `fetch` call. */
export function messagesOf(init?: RequestInit): { content: string }[] {
	return JSON.parse(String(init?.body)).messages;
}

/** The request's system prompt, read from a stubbed `fetch` call. */
export function systemOf(init?: RequestInit): string {
	return String(messagesOf(init)[0]?.content ?? '');
}

/** Points the review at a stub OpenAI-compatible endpoint with one model, optionally allowing `concurrency` parallel calls. */
export function useTestModel(concurrency?: number): void {
	setReviewOverrides({
		baseUrl: 'http://model.test/v1',
		apiKey: 'test',
		models: [{ id: 'test', label: 'Test', model: 'test' }]
	});

	if (concurrency !== undefined) process.env.RECODER_LLM_CONCURRENCY = String(concurrency);
}

/** Two models: the Review model `lead` and the second model `worker`. */
export function useTwoModels(): void {
	useTestModel(4);

	setReviewOverrides({
		...getStoredSettings(),
		models: [
			{ id: 'lead', label: 'Lead', model: 'lead' },
			{ id: 'worker', label: 'Worker', model: 'worker' }
		],
		orchestratorModelId: 'lead',
		specialistModelId: 'worker'
	});
}

/** Restores `fetch`, the review settings, LLM concurrency and the LLM limiter after each test in the calling file. */
export function restoreAfterEach(): void {
	const originalFetch = globalThis.fetch;
	const originalSettings = getStoredSettings();
	const originalConcurrency = process.env.RECODER_LLM_CONCURRENCY;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		setReviewOverrides(originalSettings);
		if (originalConcurrency === undefined) delete process.env.RECODER_LLM_CONCURRENCY;
		else process.env.RECODER_LLM_CONCURRENCY = originalConcurrency;
		resetLlmLimiter();
	});
}

/** The unit a reviewer prompt is for (`unit-1`, `retry-unit-2`…), or null for any other call. */
export function unitOf(init?: RequestInit): string | null {
	if (!systemOf(init).includes('primary reviewer')) return null;

	return /^Unit (\S+):/m.exec(String(messagesOf(init)[1]?.content ?? ''))?.[1] ?? null;
}

/**
 * Answers `TWO_UNIT_DIFF`'s reviewers and consolidation, recording each call by
 * unit id or `consolidation`. `unit-1` reports one finding; `failing` names a
 * unit whose reviewer the endpoint rejects.
 */
export function stubModel(calls: string[], failing?: string) {
	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const kind = unitOf(init) ?? 'consolidation';

		calls.push(kind);
		if (kind === failing) return new Response('bad request', { status: 400 });

		const reply =
			kind === 'unit-1'
				? { ...NOTHING, findings: [finding('possible miss')] }
				: kind === 'consolidation'
					? { keep: ['c1'], merge: [], reject: [], recommendedChecks: [] }
					: NOTHING;

		return modelReply({ message: 'ok', ...reply });
	}) as unknown as typeof fetch;
}

/**
 * A git repo whose base commit has `src/a.ts` = "old" and whose head commit
 * changes it to "new", with extra files written before each commit.
 */
export async function twoCommitRepo(
	root: string,
	files: { base?: Record<string, string>; head?: Record<string, string> } = {}
): Promise<{ targetSha: string; headSha: string }> {
	const run = (args: string[]) => git(root, args);

	const write = async (entries: Record<string, string>) => {
		for (const [path, content] of Object.entries(entries)) {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), content);
		}
	};

	run(['init', '-q', '-b', 'main']);
	run(['config', 'user.name', 'Test']);
	run(['config', 'user.email', 'test@example.com']);
	await write({ 'src/a.ts': 'old\n', ...files.base });
	run(['add', '.']);
	run(['commit', '-q', '-m', 'base']);

	const targetSha = run(['rev-parse', 'HEAD']);

	await write({ 'src/a.ts': 'new\n', ...files.head });
	run(['add', '.']);
	run(['commit', '-q', '-m', 'head']);

	return { targetSha, headSha: run(['rev-parse', 'HEAD']) };
}
