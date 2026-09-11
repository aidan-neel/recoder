import { afterEach, expect, test } from 'bun:test';
import { resetLlmLimiter } from './llm';
import { getStoredSettings, setReviewOverrides } from './review-settings';
import { runRereview } from './rereview';

const originalFetch = globalThis.fetch;
const originalSettings = getStoredSettings();
afterEach(() => {
	globalThis.fetch = originalFetch;
	setReviewOverrides(originalSettings);
	resetLlmLimiter();
});

const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
-const x = 1;
+const x = 2;
 console.log(x);
`;

function setup() {
	setReviewOverrides({
		baseUrl: 'http://model.test/v1',
		apiKey: 'test',
		models: [{ id: 'test', label: 'Test', model: 'test' }]
	});
}

const NOTE = {
	file: 'src/a.ts',
	line: 1,
	endLine: 1,
	side: 'new' as const,
	quote: 'const x = 2;',
	body: 'Should this be a named constant?',
	newText: 'const x = 2;',
	oldText: 'const x = 1;',
	diffContext: '-const x = 1;\n+const x = 2;',
	hunkHeader: '@@ -1,2 +1,2 @@'
};

test('runRereview answers each note and maps new findings', async () => {
	setup();
	let captured = '';
	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		captured = String(init?.body ?? '');
		return Response.json({
			choices: [
				{
					message: {
						content: JSON.stringify({
							summary: 'One note is valid.',
							assessments: [{ noteIndex: 0, verdict: 'valid', response: 'Agreed — extract a constant.' }],
							findings: [
								{ file: 'src/a.ts', line: 2, severity: 'medium', category: 'patterns', body: 'Magic number' }
							]
						})
					}
				}
			]
		});
	}) as unknown as typeof fetch;

	const result = await runRereview({ notes: [NOTE], diff: DIFF, sandboxPath: null, existingFindings: [] });

	expect(result.agent).toBe('orchestrator');
	expect(result.summary).toBe('One note is valid.');
	expect(result.assessments).toEqual([
		{ noteIndex: 0, verdict: 'valid', response: 'Agreed — extract a constant.' }
	]);
	expect(result.findings).toHaveLength(1);
	expect(result.findings[0]).toMatchObject({
		file: 'src/a.ts',
		line: 2,
		severity: 'warning',
		message: '[patterns] Magic number',
		agent: 'orchestrator'
	});
	// The richer selection context reaches the model.
	expect(captured).toContain('Original code:');
	expect(captured).toContain('const x = 1;');
	expect(captured).toContain('Should this be a named constant?');
});

test('runRereview rejects invalid model output', async () => {
	setup();
	globalThis.fetch = (async () =>
		Response.json({ choices: [{ message: { content: 'not json at all' } }] })) as unknown as typeof fetch;
	await expect(
		runRereview({ notes: [NOTE], diff: DIFF, sandboxPath: null, existingFindings: [] })
	).rejects.toThrow();
});
