import { afterAll, afterEach, expect, spyOn, test } from 'bun:test';
import type { ModelEntry } from '@recoder/shared';
import { opencode } from '../../../src/agents/opencode/opencode';
import { EXIT, describeError } from '../../../src/cli/exit';
import { MODEL_LOOKUP_LIMIT_MS } from '../../../src/cli/run/model-choices';
import { describeSettings } from '../../../src/cli/run/report-settings';
import { applyRunSettings, subagentCapOf } from '../../../src/cli/run/run-settings';
import { configForVerifier } from '../../../src/models/models';
import { getStoredSettings, setReviewOverrides } from '../../../src/review/session/review-settings';
import { isolateRun, reviewOptions, unstoppedLookup } from './run-fixtures';

const REVIEW_MODEL = 'opencode:openai/gpt-6.1-sol';

const SUBAGENT_MODEL = 'opencode:openai/gpt-6-luna-fast';

const SECRET_MARKER = 'sk-marker-3f9a';

const LOOKUP = unstoppedLookup(MODEL_LOOKUP_LIMIT_MS);

isolateRun();

const listModels = spyOn(opencode, 'models');

afterEach(() => listModels.mockReset());

afterAll(() => listModels.mockRestore());

/** Runs `act` with standard error captured, and returns what it wrote there. */
async function withStderr<T>(act: () => Promise<T>): Promise<{ result: T; written: string }> {
	const chunks: string[] = [];

	const capture = spyOn(process.stderr, 'write').mockImplementation((chunk) => {
		chunks.push(String(chunk));

		return true;
	});

	try {
		return { result: await act(), written: chunks.join('') };
	} finally {
		capture.mockRestore();
	}
}

/** The saved picks on this machine when the bug was found: two OpenCode models, both at medium effort. */
function saveOpenCodePicks(): void {
	setReviewOverrides({
		orchestratorModelId: REVIEW_MODEL,
		orchestratorEffort: 'medium',
		specialistModelId: SUBAGENT_MODEL,
		specialistEffort: 'medium'
	});
}

/** OpenCode's list, which has the review model with every effort and leaves the worker model out. */
function openCodeList(): ModelEntry[] {
	return [
		{
			id: REVIEW_MODEL,
			label: 'GPT 6.1 Sol',
			model: 'openai/gpt-6.1-sol',
			baseUrl: null,
			apiKeyPreview: null,
			efforts: ['low', 'medium', 'high', 'xhigh', 'max']
		}
	];
}

type Tuning = ReturnType<typeof reviewOptions>['tuning'];

/** The efforts a Low review runs with, read while its settings are applied. */
async function lowBudgetEfforts(overrides: Partial<Tuning> = {}, lookup = LOOKUP) {
	const restore = await applyRunSettings({ ...reviewOptions().tuning, budget: 'low', ...overrides }, lookup);
	const { orchestratorEffort, specialistEffort } = getStoredSettings();

	restore();

	return { orchestratorEffort, specialistEffort };
}

test('a null subagent count takes the budget cap and an explicit zero runs none', () => {
	expect(subagentCapOf({ budget: 'low', subagents: null })).toBe(3);
	expect(subagentCapOf({ budget: 'high', subagents: null })).toBe(12);
	expect(subagentCapOf({ budget: 'high', subagents: 0 })).toBe(0);
	expect(subagentCapOf({ budget: 'low', subagents: 5 })).toBe(5);
});

test('a saved OpenCode pick its agent lists runs at the low budget effort', async () => {
	saveOpenCodePicks();
	listModels.mockResolvedValue(openCodeList());

	expect((await lowBudgetEfforts()).orchestratorEffort).toBe('low');
});

test('a saved OpenCode pick its agent does not list gets no effort, as the app shows it', async () => {
	saveOpenCodePicks();
	listModels.mockResolvedValue(openCodeList());

	expect((await lowBudgetEfforts()).specialistEffort).toBeNull();
});

test('a failing OpenCode lookup leaves both picks with no effort and does not stop the review', async () => {
	saveOpenCodePicks();
	listModels.mockRejectedValue(new Error('opencode is not signed in'));

	const { result } = await withStderr(() => lowBudgetEfforts());

	expect(result).toEqual({ orchestratorEffort: null, specialistEffort: null });
});

test('an OpenCode lookup that never answers is given up at its limit and the picks get no effort', async () => {
	saveOpenCodePicks();
	listModels.mockReturnValue(new Promise(() => {}));

	const { result } = await withStderr(() => lowBudgetEfforts({}, unstoppedLookup(0)));

	expect(result).toEqual({ orchestratorEffort: null, specialistEffort: null });
});

test('a failed lookup of a saved pick says so without the agent’s own error text', async () => {
	saveOpenCodePicks();
	listModels.mockRejectedValue(new Error(`token=${SECRET_MARKER} in /home/someone/.config/opencode`));

	const { written } = await withStderr(() => lowBudgetEfforts());

	expect(written).toContain(REVIEW_MODEL);
	expect(written).not.toContain(SECRET_MARKER);
});

test('a named OpenCode model that cannot be checked is not ready, without the agent’s own error text', async () => {
	listModels.mockRejectedValue(new Error(`token=${SECRET_MARKER}`));

	const failure = await applyRunSettings({ ...reviewOptions().tuning, reviewerModel: REVIEW_MODEL }, LOOKUP).catch(
		(error: unknown) => error
	);

	expect(failure).toMatchObject({ exitCode: EXIT.notReady });
	expect(describeError(failure)).not.toContain(SECRET_MARKER);
});

test('an effort the caller asks for wins over the budget for a saved OpenCode pick', async () => {
	saveOpenCodePicks();
	listModels.mockResolvedValue(openCodeList());

	expect(await lowBudgetEfforts({ reviewerEffort: 'high', workerEffort: 'max' })).toEqual({
		orchestratorEffort: 'high',
		specialistEffort: 'max'
	});
});

const ENVIRONMENT_VARIABLES = ['RECODER_REVIEW_BASE_URL', 'RECODER_REVIEW_API_KEY', 'RECODER_REVIEW_MODEL'];

/** Runs `act` with only the environment's `model` set up, as a machine with no saved settings has it. */
async function withEnvironmentModel<T>(model: string, act: () => Promise<T>): Promise<T> {
	const before = ENVIRONMENT_VARIABLES.map((name) => [name, process.env[name]] as const);

	process.env.RECODER_REVIEW_BASE_URL = 'http://model.test/v1';
	process.env.RECODER_REVIEW_API_KEY = 'test';
	process.env.RECODER_REVIEW_MODEL = model;
	setReviewOverrides({});

	try {
		return await act();
	} finally {
		for (const [name, value] of before) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
}

test('the environment’s model can be named where no settings are saved, and it gets no effort', async () => {
	setReviewOverrides({ orchestratorEffort: 'high' });

	const efforts = await withEnvironmentModel('qwen/qwen-coder', () =>
		lowBudgetEfforts({ reviewerModel: 'qwen/qwen-coder', workerModel: 'qwen/qwen-coder' })
	);

	expect(efforts).toEqual({ orchestratorEffort: null, specialistEffort: null });
});

test('a model id the environment does not name is unknown there, and the error names the environment’s model', async () => {
	const failure = await withEnvironmentModel('qwen/qwen-coder', () =>
		applyRunSettings({ ...reviewOptions().tuning, reviewerModel: 'other/model' }, LOOKUP).catch(
			(error: unknown) => error
		)
	);

	expect(failure).toMatchObject({ exitCode: EXIT.usage });
	expect(describeError(failure)).toContain('"other/model"');
	expect(describeError(failure)).toContain('qwen/qwen-coder');
});

test('an environment model named like an agent id is not accepted as the environment’s model', async () => {
	const named = 'claude-code:not-a-claude-model';

	const failure = await withEnvironmentModel(named, () =>
		applyRunSettings({ ...reviewOptions().tuning, reviewerModel: named }, LOOKUP).catch((error: unknown) => error)
	);

	expect(failure).toMatchObject({ exitCode: EXIT.usage });
});

test('--verifier sets verifierModelId for the run and describeSettings reports it only when it differs from the Review model', async () => {
	setReviewOverrides({
		baseUrl: 'http://model.test/v1',
		apiKey: 'test',
		models: [
			{ id: 'lead', label: 'Lead', model: 'lead-model', efforts: ['low', 'medium', 'high'] },
			{ id: 'judge', label: 'Judge', model: 'judge-model', efforts: ['low', 'medium', 'high'] }
		],
		orchestratorModelId: 'lead'
	});

	const defaultTuning = { ...reviewOptions().tuning, budget: 'low' as const };
	const restoreDefault = await applyRunSettings(defaultTuning, LOOKUP);
	const sameSettings = await describeSettings(defaultTuning, null);

	restoreDefault();
	expect(sameSettings.verifierModel).toBeNull();

	const verifierTuning = { ...defaultTuning, verifierModel: 'judge' };
	const restoreVerifier = await applyRunSettings(verifierTuning, LOOKUP);
	const resolvedVerifier = configForVerifier();
	const differentSettings = await describeSettings(verifierTuning, null);

	restoreVerifier();
	expect(resolvedVerifier).toMatchObject({ model: 'judge-model', reasoningEffort: 'low' });
	expect(differentSettings.verifierModel).toBe('judge-model');
	expect(getStoredSettings().verifierModelId).toBeUndefined();
});
