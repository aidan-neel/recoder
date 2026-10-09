import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAdaptiveReview } from '../../../src/review/pipeline/harness';
import { execUnavailableReason } from '../../../src/sandbox/exec-sandbox';
import {
	DIFF,
	NOTHING,
	RUNNABLE,
	TWO_UNIT_DIFF,
	confirmingVerifier,
	finding,
	isVerifier,
	messagesOf,
	modelReply,
	restoreAfterEach,
	runnableCheckout,
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
	/** Reviewer findings: a body for the standard finding on line 1, or a whole finding. */
	findings: (string | ReturnType<typeof finding>)[];
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
			reply = {
				...NOTHING,
				findings: model.findings.map((entry) => (typeof entry === 'string' ? finding(entry) : entry))
			};
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
			const imagined = finding('Imagined bug.');

			const result = await reviewWithFakeModel(root, RUNNABLE, {
				findings: [
					'Real bug.',
					{
						...imagined,
						claim: {
							...imagined.claim,
							trigger: 'A retry after a timeout',
							consequence: 'The request is sent twice',
							violatedContract: 'Each request is sent once'
						}
					}
				]
			});

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
		const result = await reviewWithFakeModel(root, RUNNABLE, { findings: ['Real bug.'], realCommand, head });

		return result.findings[0].verification;
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

/** Reviews a repo with `base` that raises one bug, and returns the review and how many verifier calls it made. */
async function reviewOneBug(base: Record<string, string>) {
	useTestModel(4);

	const root = await mkdtemp(join(tmpdir(), 'recoder-verify-unrun-'));
	let verifiers = 0;

	try {
		const result = await reviewWithFakeModel(root, base, {
			findings: ['Real bug.'],
			interceptVerifier: () => {
				verifiers++;

				return null;
			}
		});

		return { result, verifiers };
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test.skipIf((await execUnavailableReason()) !== null)(
	'a bug in a review where no check passes is shown unverified as not run, with no verifier call',
	async () => {
		const { result, verifiers } = await reviewOneBug({
			'package.json': JSON.stringify({ scripts: { test: 'exit 1' } })
		});

		expect(verifiers).toBe(0);

		expect(result.findings[0].verification).toMatchObject({
			status: 'unverified',
			outcome: 'not-run',
			reason: expect.stringContaining("none of this repository's checks passed")
		});

		expect(result.funnel).toMatchObject({ raised: 1, unproven: 0, verified: 0, notRun: 1, shown: 1 });
	}
);

test.skipIf((await execUnavailableReason()) !== null)(
	'a bug in a review with no check to run is shown unverified as not run, with no verifier call',
	async () => {
		const { result, verifiers } = await reviewOneBug({});

		expect(verifiers).toBe(0);

		expect(result.findings[0].verification).toMatchObject({
			outcome: 'not-run',
			reason: expect.stringContaining('no type check, lint or test command')
		});
	}
);

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

			const result = await reviewWithFakeModel(root, RUNNABLE, {
				findings: ['Real bug.'],
				interceptVerifier: (messages) =>
					messages.length === 2 && ++verifiers === 1 ? new Response('bad request', { status: 400 }) : null
			});

			expect(verifiers).toBe(2);
			expect(result.findings[0].verification).toMatchObject({ status: 'verified', method: 'run' });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}
);

test.skipIf((await execUnavailableReason()) !== null)(
	'a finding is verified while later reviewers are still working',
	async () => {
		useTestModel(4);

		let verified = () => {};
		const verdict = new Promise<void>((resolve) => (verified = resolve));
		const order: string[] = [];
		let raised = false;

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

			const raises = unit === 'unit-1/correctness' && !raised;

			if (raises) raised = true;

			return modelReply({ message: 'ok', ...NOTHING, findings: raises ? [finding('possible miss')] : [] });
		}) as unknown as typeof fetch;

		const checkout = await runnableCheckout();

		try {
			const result = await runAdaptiveReview({ diff: TWO_UNIT_DIFF, ...checkout.input });

			expect(order.slice(0, 2)).toEqual(['verdict', 'unit-2/readability']);
			expect(result.findings.map((item) => item.title)).toEqual(['possible miss']);
		} finally {
			await checkout.remove();
		}
	}
);

test.skipIf((await execUnavailableReason()) !== null)(
	'two low reports of one bug share a reproduction and are both published and counted as verified',
	async () => {
		useTestModel(4);

		const root = await mkdtemp(join(tmpdir(), 'recoder-verify-share-'));
		let verifiers = 0;

		try {
			const result = await reviewWithFakeModel(root, RUNNABLE, {
				findings: [finding('Real bug.', 'low'), { ...finding('Real bug.', 'low'), body: 'Real bug. Seen again.' }],
				realCommand: 'grep -c old src/a.ts',
				interceptVerifier: (messages) => {
					if (messages.length === 2) verifiers++;

					return null;
				}
			});

			expect(verifiers).toBe(1);
			expect(result.findings).toHaveLength(1);
			expect(result.findings[0].memberIds).toHaveLength(2);
			expect(result.findings[0].verification).toMatchObject({ status: 'verified', outcome: 'reproduced' });
			expect(result.funnel).toMatchObject({ raised: 2, verified: 2, shown: 1 });
			expect(result.funnel?.dropped.severity).toBe(0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}
);
