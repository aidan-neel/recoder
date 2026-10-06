import { afterEach } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { resetLlmLimiter } from '../../../src/models/llm';
import { LENSES } from '../../../src/review/pipeline/lenses/lenses';
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
 * Neither is docs, so each runs every lens.
 */
export const TWO_UNIT_DIFF = addedFile('src/a.ts', 140) + addedFile('tests/b.ts', 140);

/** The lens assignment ids for a unit, in the order the review runs them (`unit-1/correctness`…). */
export function lensIdsOf(unitId: string): string[] {
	return LENSES.map((lens) => `${unitId}/${lens.id}`);
}

/** An empty reviewer answer. */
export const NOTHING = {
	findings: [],
	examinedHunks: [HUNK],
	gaps: [],
	blockers: [],
	subagents: [],
	recommendedChecks: []
};

/** A correctness finding on line 1 of `src/a.ts`, with a full claim, titled and described by `body`. */
export const finding = (body: string, severity = 'medium', evidenceIds: string[] = []) => ({
	title: body,
	file: 'src/a.ts',
	line: 1,
	severity,
	category: 'correctness',
	symbol: null,
	claim: {
		trigger: 'Any call after the change',
		executionPath: [{ file: 'src/a.ts', line: 1, note: 'the changed line' }],
		consequence: 'The old value is lost',
		violatedContract: 'The value must be kept'
	},
	body,
	evidenceIds
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

/** Restores `fetch`, the review settings, LLM concurrency, the data directory and the LLM limiter after each test in the calling file. */
export function restoreAfterEach(): void {
	const originalFetch = globalThis.fetch;
	const originalSettings = getStoredSettings();
	const originalConcurrency = process.env.RECODER_LLM_CONCURRENCY;
	const originalDataDir = process.env.RECODER_DATA_DIR;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		setReviewOverrides(originalSettings);
		if (originalConcurrency === undefined) delete process.env.RECODER_LLM_CONCURRENCY;
		else process.env.RECODER_LLM_CONCURRENCY = originalConcurrency;
		if (originalDataDir === undefined) delete process.env.RECODER_DATA_DIR;
		else process.env.RECODER_DATA_DIR = originalDataDir;
		resetLlmLimiter();
	});
}

/** Whether a stubbed call is a lens reviewer's. */
export function isLensReviewer(init?: RequestInit): boolean {
	return systemOf(init).includes(' lens reviewer.');
}

/** The lens assignment a reviewer prompt is for (`unit-1/correctness`, `retry-unit-2/security`…), or null for any other call. */
export function unitOf(init?: RequestInit): string | null {
	if (!isLensReviewer(init)) return null;

	return /^Unit (\S+):/m.exec(String(messagesOf(init)[1]?.content ?? ''))?.[1] ?? null;
}

/** The obligation an investigator prompt is for (`obligation-1`…), or null for any other call. */
export function obligationOf(init?: RequestInit): string | null {
	if (!systemOf(init).includes('Role: obligation investigator')) return null;

	return /^Obligation (\S+):/m.exec(String(messagesOf(init)[1]?.content ?? ''))?.[1] ?? null;
}

/** Whether a stubbed call is a verifier's. */
export function isVerifier(init?: RequestInit): boolean {
	return systemOf(init).includes('You verify one code review finding');
}

/** Whether a stubbed call is the intent stage's, which distills the brief before the lenses run. */
function isIntent(init?: RequestInit): boolean {
	return systemOf(init).includes('You write the brief a code change is reviewed against');
}

/** The first evidence id anywhere in the call's messages, such as the scoped patch a reviewer starts with. */
function evidenceIn(init?: RequestInit): string | null {
	return (
		/evidenceId=(ev_\d+)/.exec(
			messagesOf(init)
				.map((message) => message.content)
				.join('\n')
		)?.[1] ?? null
	);
}

/** A verifier that confirms its finding citing evidence it was shown, reading the diff first when it saw none. */
export function confirmingVerifier(init?: RequestInit): unknown {
	const cited = evidenceIn(init);

	return cited
		? { message: 'Traced it.', verdict: 'confirmed', reason: 'The changed line drops the value.', evidenceIds: [cited] }
		: { message: 'Reading the diff.', actions: [{ action: 'readDiff', path: 'src/a.ts' }] };
}

/** The stage a stubbed call belongs to: a lens assignment or obligation id, `verifier`, `intent`, or `other` for any stage not expected to call a model. */
function stageOf(init?: RequestInit): string {
	return unitOf(init) ?? obligationOf(init) ?? (isVerifier(init) ? 'verifier' : isIntent(init) ? 'intent' : 'other');
}

/**
 * Answers `TWO_UNIT_DIFF`'s lens reviewers and verifiers, recording each
 * call by assignment id, `verifier`, `intent` or `other`. `unit-1/correctness`
 * reports one finding, citing its scoped patch; every verifier confirms;
 * `failing` names an assignment whose reviewer the endpoint rejects.
 */
export function stubModel(calls: string[], failing?: string) {
	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const unit = unitOf(init);
		const kind = stageOf(init);

		calls.push(kind);
		if (kind === failing) return new Response('bad request', { status: 400 });
		if (kind === 'verifier') return modelReply(confirmingVerifier(init));

		const cited = evidenceIn(init);

		const reply =
			unit === 'unit-1/correctness'
				? { ...NOTHING, findings: [finding('possible miss', 'medium', cited ? [cited] : [])] }
				: NOTHING;

		return modelReply({ message: 'ok', ...reply });
	}) as unknown as typeof fetch;
}

/**
 * Stubs a review of `addedFile('src/a.ts', 5)` whose correctness reviewers
 * report `findings` and whose verifiers confirm them; `onVerifier` hears each
 * verifier call.
 */
export function stubFindings(findings: unknown[], onVerifier?: () => void): void {
	useTestModel();

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		if (isVerifier(init)) {
			onVerifier?.();

			return modelReply(confirmingVerifier(init));
		}

		const reported = unitOf(init)?.endsWith('/correctness') === true ? findings : [];

		return modelReply({ message: 'ok', ...NOTHING, examinedHunks: ['src/a.ts:0,0:1,5'], findings: reported });
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
