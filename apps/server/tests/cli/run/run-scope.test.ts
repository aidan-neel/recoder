import { expect, test } from 'bun:test';
import { withRunScope } from '../../../src/cli/run/run-scope';
import { configForOrchestrator } from '../../../src/models/models';
import { getStoredSettings, setReviewOverrides } from '../../../src/review/session/review-settings';
import { MODEL_LOOKUP_LIMIT_MS } from '../../../src/cli/run/model-choices';
import { isolateRun, reviewOptions, unstoppedLookup } from './run-fixtures';

isolateRun();

const LOOKUP = unstoppedLookup(MODEL_LOOKUP_LIMIT_MS);

const VARIABLES = ['RECODER_EXEC', 'RECODER_OBLIGATIONS', 'RECODER_RESIDUAL'];

/** Runs `check` with those variables set as given, then puts them back. */
async function withEnv(values: Record<string, string | undefined>, check: () => Promise<void>): Promise<void> {
	const before = VARIABLES.map((name) => [name, process.env[name]] as const);

	for (const name of VARIABLES) {
		const value = values[name];

		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}

	try {
		await check();
	} finally {
		for (const [name, value] of before) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
}

function twoModels(): void {
	setReviewOverrides({
		baseUrl: 'http://model.test/v1',
		apiKey: 'test',
		models: [
			{ id: 'lead', label: 'Lead', model: 'lead-model' },
			{ id: 'worker', label: 'Worker', model: 'worker-model' }
		],
		orchestratorModelId: 'lead'
	});
}

test('levers, no-exec, console and model picks apply inside the run and are all undone when it throws', async () => {
	twoModels();

	const saved = getStoredSettings();
	const log = console.log;

	const tuning = {
		...reviewOptions().tuning,
		levers: ['obligations' as const, 'residual' as const],
		exec: false,
		reviewerModel: 'worker',
		maxFileChars: 500
	};

	await withEnv({ RECODER_OBLIGATIONS: '0', RECODER_RESIDUAL: undefined, RECODER_EXEC: undefined }, async () => {
		const inside: Record<string, unknown> = {};

		await expect(
			withRunScope(tuning, LOOKUP, async () => {
				inside.env = VARIABLES.map((name) => process.env[name]);
				inside.log = console.log === log;
				inside.settings = getStoredSettings();

				throw new Error('harness failed');
			})
		).rejects.toThrow('harness failed');

		expect(inside.env).toEqual(['off', '1', '1']);
		expect(inside.log).toBe(false);
		expect(inside.settings).toMatchObject({ orchestratorModelId: 'worker', maxFileChars: 500 });
		expect(VARIABLES.map((name) => process.env[name])).toEqual([undefined, '0', undefined]);
		expect(console.log).toBe(log);
		expect(getStoredSettings()).toBe(saved);
	});
});

test('a model id no setup has fails as a usage error naming it, with nothing left changed', async () => {
	twoModels();

	const saved = getStoredSettings();
	const tuning = { ...reviewOptions().tuning, reviewerModel: 'no-such-model', levers: ['residual' as const] };

	await withEnv({}, async () => {
		await expect(withRunScope(tuning, LOOKUP, async () => 'ran')).rejects.toMatchObject({
			exitCode: 2,
			message: expect.stringContaining('no-such-model')
		});

		expect(process.env.RECODER_RESIDUAL).toBeUndefined();
	});

	expect(getStoredSettings()).toBe(saved);
});

test('a null effort takes the budget effort the model offers and an asked one wins', async () => {
	setReviewOverrides({
		baseUrl: 'http://model.test/v1',
		apiKey: 'test',
		models: [{ id: 'lead', label: 'Lead', model: 'lead-model', efforts: ['low', 'high'], defaultEffort: 'high' }]
	});

	const budget = { ...reviewOptions().tuning, budget: 'medium' as const };
	let fromBudget: unknown;
	let asked: unknown;

	await withRunScope(budget, LOOKUP, async () => {
		fromBudget = getStoredSettings().orchestratorEffort;
	});

	await withRunScope({ ...budget, reviewerEffort: 'high' }, LOOKUP, async () => {
		asked = getStoredSettings().orchestratorEffort;
	});

	expect(fromBudget).toBe('low');
	expect(asked).toBe('high');
});

test('a saved effort is not sent to a model that offers no effort levels', async () => {
	setReviewOverrides({
		baseUrl: 'http://model.test/v1',
		apiKey: 'test',
		models: [{ id: 'plain', label: 'Plain', model: 'plain-model' }],
		orchestratorEffort: 'high'
	});

	const tuning = reviewOptions().tuning;
	let sent: unknown = 'unset';
	let reported: unknown = 'unset';

	await withRunScope({ ...tuning, reviewerModel: 'plain' }, LOOKUP, async () => {
		sent = getStoredSettings().orchestratorEffort;
		reported = configForOrchestrator().reasoningEffort;
	});

	expect(sent).toBeNull();
	expect(reported).toBeUndefined();

	await withRunScope(tuning, LOOKUP, async () => {
		sent = getStoredSettings().orchestratorEffort;
		reported = configForOrchestrator().reasoningEffort;
	});

	expect(sent).toBeNull();
	expect(reported).toBeUndefined();
});
