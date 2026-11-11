import { afterEach, expect, spyOn, test } from 'bun:test';
import { codex } from '../../../src/agents/codex/codex';
import { opencode } from '../../../src/agents/opencode/opencode';
import { CliError, EXIT, describeError } from '../../../src/cli/exit';
import type { ProgressEvent } from '../../../src/cli/progress';
import { runReviewFlow, type TargetResolver } from '../../../src/cli/run/run-flow';
import { finding, stubFindings, useTestModel } from '../../review/pipeline/harness-fixtures';
import { setReviewOverrides } from '../../../src/review/session/review-settings';
import type { ResolvedTarget } from '../../../src/cli/target/resolve-target';
import { fakeTarget, isolateRun, reviewOptions } from './run-fixtures';

isolateRun();

const never = new AbortController().signal;

const realTimeout = AbortSignal.timeout;

afterEach(() => {
	AbortSignal.timeout = realTimeout;
});

const NO_REVIEW_ENV = ['RECODER_REVIEW_BASE_URL', 'RECODER_REVIEW_API_KEY', 'RECODER_REVIEW_MODEL'];

test('with no review model the run stops as not ready before it resolves the target', async () => {
	const saved = NO_REVIEW_ENV.map((name) => [name, process.env[name]] as const);

	for (const name of NO_REVIEW_ENV) delete process.env[name];
	setReviewOverrides({});

	let resolved = 0;

	const resolve: TargetResolver = async () => {
		resolved++;

		return fakeTarget().target;
	};

	try {
		await expect(runReviewFlow(resolve, reviewOptions(), () => {}, never)).rejects.toMatchObject({
			name: 'CliError',
			exitCode: EXIT.notReady,
			message: expect.stringContaining('recoder doctor')
		});
	} finally {
		for (const [name, value] of saved) if (value !== undefined) process.env[name] = value;
	}

	expect(resolved).toBe(0);
});

test('a finished review reports its findings without bookkeeping and says why no code ran', async () => {
	stubFindings([{ ...finding('lost value'), line: 1 }]);

	const { target, disposed } = fakeTarget();
	const events: ProgressEvent[] = [];

	const report = await runReviewFlow(
		async () => target,
		reviewOptions(),
		(event) => events.push(event),
		never
	);

	expect(report.outcome).toBe('complete');
	expect(report.findings).toHaveLength(1);
	expect(report.findings[0]).toMatchObject({ file: 'src/a.ts', line: 1, severity: 'warning' });
	expect('fingerprint' in report.findings[0]).toBe(false);
	expect(report.settings).toMatchObject({ exec: false, subagents: 8, budget: 'medium', reviewerModel: 'test' });
	expect(report.settings.execReason).toContain('no checkout');
	expect(events[0]).toEqual({ type: 'stage', stage: 'checkout' });
	expect(events.some((event) => event.type === 'stage' && event.stage === 'reviewing')).toBe(true);
	expect(disposed()).toBe(1);
});

test('the caller can keep the checkout', async () => {
	stubFindings([]);

	const { target, disposed } = fakeTarget();

	await runReviewFlow(
		async () => target,
		reviewOptions({ keepCheckout: true }),
		() => {},
		never
	);

	expect(disposed()).toBe(0);
});

/** Runs a review whose model must never be called, with a resolver that cancels it, and checks it reports cancelled and disposes. */
async function expectCancelledBeforeModel(
	cancel: (controller: AbortController, target: ResolvedTarget) => TargetResolver
): Promise<void> {
	let calls = 0;

	useTestModel();

	globalThis.fetch = (async () => {
		calls++;

		return new Response('unexpected', { status: 500 });
	}) as unknown as typeof fetch;

	const { target, disposed } = fakeTarget();
	const controller = new AbortController();

	const report = await runReviewFlow(cancel(controller, target), reviewOptions(), () => {}, controller.signal);

	expect(report.outcome).toBe('cancelled');
	expect(calls).toBe(0);
	expect(disposed()).toBe(1);
}

test('a run already cancelled reports cancelled without calling the model, and still disposes the target', async () => {
	await expectCancelledBeforeModel((controller, target) => {
		controller.abort();

		return async () => target;
	});
});

test('a run cancelled while the model works reports cancelled and still disposes the target', async () => {
	useTestModel();

	const controller = new AbortController();

	globalThis.fetch = (async () => {
		controller.abort();

		return new Response('cancelled', { status: 500 });
	}) as unknown as typeof fetch;

	const { target, disposed } = fakeTarget();

	const report = await runReviewFlow(
		async () => target,
		reviewOptions(),
		() => {},
		controller.signal
	);

	expect(report.outcome).toBe('cancelled');
	expect(report.error).toContain('cancelled');
	expect(disposed()).toBe(1);
});

test('an explicit zero subagents is what the report says the review ran with', async () => {
	stubFindings([]);

	const options = reviewOptions();
	const tuning = { ...options.tuning, subagents: 0 };

	const report = await runReviewFlow(
		async () => fakeTarget().target,
		{ ...options, tuning },
		() => {},
		never
	);

	expect(report.settings.subagents).toBe(0);
	expect(report.settings.budget).toBe('medium');
});

test('the timeout also covers resolving the target, and the error says so', async () => {
	stubFindings([]);

	const timeout = new AbortController();

	AbortSignal.timeout = () => timeout.signal;

	const resolve: TargetResolver = async (request) => {
		await new Promise((done) => {
			request.signal.addEventListener('abort', done, { once: true });
			timeout.abort();
		});

		throw new CliError('Cancelled while preparing what to review.', EXIT.cancelled);
	};

	await expect(runReviewFlow(resolve, reviewOptions({ timeoutMs: 1000 }), () => {}, never)).rejects.toMatchObject({
		exitCode: EXIT.cancelled,
		message: expect.stringContaining('timeout')
	});
});

test('a cancel that arrives while resolving, for a resolver that finishes anyway, reports cancelled and disposes', async () => {
	await expectCancelledBeforeModel((controller, target) => async () => {
		controller.abort();

		return target;
	});
});

/**
 * Runs a review whose saved Review model is an OpenCode pick, while OpenCode's model list never answers and `stop`
 * runs the moment the list is asked for. The target must never be resolved.
 */
async function reviewStoppedDuringLookup(
	options: ReturnType<typeof reviewOptions>,
	signal: AbortSignal,
	stop: () => void
) {
	setReviewOverrides({ orchestratorModelId: 'opencode:openai/gpt-6.1-sol', orchestratorEffort: 'medium' });

	const listModels = spyOn(opencode, 'models').mockImplementation(() => {
		stop();

		return new Promise(() => {});
	});

	const resolve: TargetResolver = async () => {
		throw new Error('the target was resolved');
	};

	try {
		return await runReviewFlow(resolve, options, () => {}, signal).catch((error: unknown) => error);
	} finally {
		listModels.mockRestore();
	}
}

test('a cancel while OpenCode lists its models ends the run as cancelled', async () => {
	const controller = new AbortController();

	const failure = await reviewStoppedDuringLookup(reviewOptions(), controller.signal, () => controller.abort());

	expect(failure).toMatchObject({ exitCode: EXIT.cancelled, message: expect.stringContaining('cancelled') });
});

test('the timeout also covers OpenCode listing its models, and the error says so', async () => {
	const timeout = new AbortController();

	AbortSignal.timeout = () => timeout.signal;

	const failure = await reviewStoppedDuringLookup(reviewOptions({ timeoutMs: 1000 }), never, () => timeout.abort());

	expect(failure).toMatchObject({ exitCode: EXIT.cancelled, message: expect.stringContaining('timeout') });
});

/** Reviews with a ChatGPT model saved, the sign-in as `signedIn` says, and a resolver that counts its calls. */
async function reviewWithChatGptModel(signedIn: boolean): Promise<{ failure: unknown; resolved: number }> {
	setReviewOverrides({ models: [{ id: 'gpt', provider: 'codex', label: 'GPT', model: 'gpt-x' }] });

	const sign = spyOn(codex, 'signedIn').mockResolvedValue(signedIn);
	let resolved = 0;

	const resolve: TargetResolver = async () => {
		resolved++;

		throw new Error('the target was resolved');
	};

	try {
		const failure = await runReviewFlow(resolve, reviewOptions(), () => {}, never).catch((error: unknown) => error);

		return { failure, resolved };
	} finally {
		sign.mockRestore();
	}
}

test('a ChatGPT model with no sign-in stops the run as not ready before the target is prepared', async () => {
	const { failure, resolved } = await reviewWithChatGptModel(false);

	expect(failure).toMatchObject({ exitCode: EXIT.notReady });
	expect(describeError(failure)).toContain('Sign in to ChatGPT');
	expect(resolved).toBe(0);
});

test('a ChatGPT model that is signed in goes on to prepare the target', async () => {
	expect((await reviewWithChatGptModel(true)).resolved).toBe(1);
});
