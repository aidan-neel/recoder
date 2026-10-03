import { afterEach } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { resetLlmLimiter } from '../../../src/models/llm';
import { REVIEW_ROLES, type ReviewRole } from '../../../src/review/pipeline/roles';
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

/** A planner assignment over the one hunk in `DIFF`. */
export const assignment = (id: string, role: ReviewRole, priority: number) => ({
	id,
	role,
	title: id,
	reason: 'must',
	scope: [{ path: 'src/a.ts', hunkIds: [HUNK] }],
	questions: ['q'],
	contextEvidenceIds: [],
	priority
});

/** Planner role decisions selecting exactly `selected`. */
export function decisions(selected: string[]) {
	return REVIEW_ROLES.map((role) => ({
		role,
		decision: selected.includes(role) ? 'selected' : 'not_needed',
		reason: selected.includes(role) ? 'needed' : 'not this PR'
	}));
}

export const PLAN = {
	summary: 'two specialists',
	assignments: [assignment('correctness-core', 'correctness', 1), assignment('patterns-core', 'patterns', 2)],
	roleDecisions: decisions(['correctness', 'patterns'])
};

/** An empty specialist answer that read nothing; the agent loop sends it back once before accepting it. */
export const NOTHING = {
	findings: [],
	examinedHunks: [HUNK],
	coverageGaps: [],
	blockers: [],
	followUp: null,
	recommendedChecks: []
};

/** A consolidation answer that keeps nothing. */
export const KEEP_NONE = { keep: [], merge: [], reject: [], recommendedChecks: [] };

/** A specialist finding on line 1 of `src/a.ts`. */
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

/** Answers each prompt by its kind; `patterns` decides whether that specialist fails. */
export function stubModel(calls: string[], patterns: 'fail' | 'ok') {
	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const system = systemOf(init);

		const kind = system.includes('review orchestrator')
			? 'planner'
			: system.includes('(correctness)')
				? 'correctness'
				: system.includes('(patterns)')
					? 'patterns'
					: 'consolidation';

		calls.push(kind);
		if (kind === 'patterns' && patterns === 'fail') return new Response('bad request', { status: 400 });

		const reply =
			kind === 'planner'
				? PLAN
				: kind === 'correctness'
					? { ...NOTHING, findings: [finding('possible miss')] }
					: kind === 'patterns'
						? NOTHING
						: { keep: ['c1'], merge: [], reject: [], recommendedChecks: [] };

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
