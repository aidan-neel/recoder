import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAdaptiveReview } from '../../../src/review/pipeline/harness';
import { execUnavailableReason } from '../../../src/sandbox/exec-sandbox';
import {
	DIFF,
	NOTHING,
	TWO_UNIT_DIFF,
	confirmingVerifier,
	finding,
	isVerifier,
	messagesOf,
	modelReply,
	restoreAfterEach,
	twoCommitRepo,
	unitOf,
	useTestModel
} from './harness-fixtures';

restoreAfterEach();

/** Proves the real bug with a failing grep and refutes the imagined one with a passing grep. */
function verifierReply(user: string, last: string, realCommand: string): unknown {
	const real = user.includes('Real bug.');
	const proof = /evidenceId=(ev_\d+)/.exec(last)?.[1];

	if (!proof) return { actions: [{ action: 'run', command: real ? realCommand : 'grep -c new src/a.ts' }] };

	return real
		? { verdict: 'confirmed', reason: 'grep shows it.', evidenceIds: [proof], expected: 'grep finds nothing.' }
		: { verdict: 'refuted', reason: 'grep shows otherwise.', evidenceIds: [proof] };
}

interface FakeModel {
	findings: string[];
	/** The command the verifier runs to prove the real bug. */
	realCommand?: string;
	/** Files the head commit adds or changes. */
	head?: Record<string, string>;
	/** A response that replaces a verifier turn, or null to answer it normally. */
	interceptVerifier?: (messages: ReturnType<typeof messagesOf>) => Response | null;
}

/** Reviews a two-commit repo in `root` with a stub model: reviewers raise `findings`, verifiers grep for them. */
async function reviewWithFakeModel(root: string, base: Record<string, string>, model: FakeModel) {
	const { targetSha, headSha } = await twoCommitRepo(root, { base, head: model.head });

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const messages = messagesOf(init);
		const user = messages[1].content;
		let reply: unknown = NOTHING;

		if (unitOf(init) === 'unit-1/correctness') {
			reply = { ...NOTHING, findings: model.findings.map((message) => finding(message)) };
		} else if (isVerifier(init)) {
			const intercepted = model.interceptVerifier?.(messages);

			if (intercepted) return intercepted;
			reply = verifierReply(user, messages.at(-1)!.content, model.realCommand ?? 'grep -c missing src/a.ts');
		}

		return modelReply({ message: 'Working.', ...(reply as object) });
	}) as unknown as typeof fetch;

	return runAdaptiveReview({
		diff: DIFF,
		sandboxPath: root,
		revision: { checkoutPath: root, headSha, targetSha, mergeBaseSha: targetSha, targetRef: 'main' }
	});
}

test.skipIf((await execUnavailableReason()) !== null)(
	'verification drops a finding a run disproves and marks a reproduced one verified',
	async () => {
		useTestModel(4);

		const root = await mkdtemp(join(tmpdir(), 'recoder-verify-review-'));

		try {
			const result = await reviewWithFakeModel(
				root,
				{ 'package.json': JSON.stringify({ scripts: { test: 'cat src/a.ts' } }) },
				{ findings: ['Real bug.', 'Imagined bug.'] }
			);

			expect(result.findings).toHaveLength(1);
			expect(result.findings[0].message).toContain('Real bug.');

			expect(result.findings[0].verification).toMatchObject({
				status: 'verified',
				method: 'run',
				outcome: 'reproduced',
				reason: expect.stringContaining('grep shows it.'),
				command: 'grep -c missing src/a.ts',
				exitCode: 1,
				evidence: {
					command: 'grep -c missing src/a.ts',
					exitCode: 1,
					observed: '0',
					baseline: { exitCode: 1, differs: false }
				}
			});

			expect(result.summary).toContain('1 verified by running code');
			expect(result.unconfirmed.map((hidden) => hidden.message)).toEqual([expect.stringContaining('Imagined bug.')]);

			expect(result.funnel).toMatchObject({ raised: 2, verified: 1, unproven: 0, shown: 1 });
			expect(result.funnel?.dropped.refuted).toBe(1);

			expect(result.unconfirmed[0].verification).toMatchObject({
				status: 'unverified',
				outcome: 'refuted',
				reason: expect.stringContaining('refuted')
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}
);

/** Reviews a repo whose one real finding is proven by `realCommand`, and returns that finding's verification. */
async function baselineOf(realCommand: string, head?: Record<string, string>) {
	useTestModel(4);

	const root = await mkdtemp(join(tmpdir(), 'recoder-verify-base-'));

	try {
		const result = await reviewWithFakeModel(root, {}, { findings: ['Real bug.'], realCommand, head });

		return result.findings[0].verification;
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test.skipIf((await execUnavailableReason()) !== null)(
	'a repro that passes on the base commit is marked as changed by this change',
	async () => {
		expect(await baselineOf('grep -c old src/a.ts')).toMatchObject({
			status: 'verified',
			evidence: { expected: 'grep finds nothing.', baseline: { exitCode: 0, differs: true } }
		});
	}
);

test.skipIf((await execUnavailableReason()) !== null)(
	'a repro that fails the same way on the base commit stays verified and says so',
	async () => {
		const verification = await baselineOf('grep -c missing src/a.ts');

		expect(verification).toMatchObject({ status: 'verified', evidence: { baseline: { differs: false } } });
		expect(verification?.reason).toContain('before this change');
	}
);

test.skipIf((await execUnavailableReason()) !== null)(
	'a base run that cannot happen leaves the finding as it was',
	async () => {
		const verification = await baselineOf('grep -c old src/a.ts', { 'pyproject.toml': '[project]\nname = "x"\n' });

		expect(verification).toMatchObject({
			status: 'verified',
			method: 'run',
			outcome: 'reproduced',
			reason: 'grep shows it.',
			evidence: { baseline: { unavailable: expect.stringContaining('manifests') } }
		});
	}
);

test.skipIf((await execUnavailableReason()) !== null)(
	'a verifier that fails before its verdict gets a second attempt',
	async () => {
		useTestModel(4);

		const root = await mkdtemp(join(tmpdir(), 'recoder-verify-retry-'));

		try {
			let verifiers = 0;

			const result = await reviewWithFakeModel(
				root,
				{},
				{
					findings: ['Real bug.'],
					interceptVerifier: (messages) =>
						messages.length === 2 && ++verifiers === 1 ? new Response('bad request', { status: 400 }) : null
				}
			);

			expect(verifiers).toBe(2);
			expect(result.findings[0].verification).toMatchObject({ status: 'verified', method: 'run' });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}
);

test('a finding is verified while later reviewers are still working', async () => {
	useTestModel(4);

	let verified = () => {};
	const verdict = new Promise<void>((resolve) => (verified = resolve));
	const order: string[] = [];

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const unit = unitOf(init);

		if (isVerifier(init)) {
			const reply = confirmingVerifier(init) as { verdict?: string };

			if (reply.verdict) {
				order.push('verdict');
				verified();
			}

			return modelReply(reply);
		}

		if (unit === 'unit-2/readability') {
			await verdict;
			order.push(unit);
		}

		return modelReply({
			message: 'ok',
			...NOTHING,
			findings: unit === 'unit-1/correctness' ? [finding('possible miss')] : []
		});
	}) as unknown as typeof fetch;

	const result = await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null });

	expect(order).toEqual(['verdict', 'unit-2/readability']);
	expect(result.findings.map((item) => item.title)).toEqual(['possible miss']);
});
