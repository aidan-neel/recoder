import { afterEach, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { reviewModelStep, type ModelChoice } from '../../../src/cli/init/model-step';
import { openRunSignal } from '../../../src/cli/run/run-signal';
import { getStoredSettings, setReviewOverrides } from '../../../src/review/session/review-settings';
import { testDataDir } from '../child-env';
import { useFreshDataDir } from '../runs/run-fixtures';

useFreshDataDir();

afterEach(() => setReviewOverrides({}));

/** A choice with nobody to ask and no flag, with the parts a test sets replaced. */
function choice(overrides: Partial<ModelChoice> = {}): ModelChoice {
	return {
		requested: null,
		pick: null,
		listing: (work) => work(),
		lookup: { stop: openRunSignal(new AbortController().signal, null), limitMs: 1000 },
		...overrides
	};
}

const settingsFile = (): string => join(testDataDir(), 'review-config.json');

test('a model named by --reviewer is saved as the review model', async () => {
	const step = await reviewModelStep(choice({ requested: 'claude-code:opus' }));

	expect(step).toMatchObject({ state: 'done' });
	expect(getStoredSettings().orchestratorModelId).toBe('claude-code:opus');
	expect(existsSync(settingsFile())).toBe(true);
});

test('a model id this machine does not accept fails the step and saves nothing', async () => {
	const step = await reviewModelStep(choice({ requested: 'no-such-model' }));

	expect(step).toMatchObject({ state: 'failed', detail: expect.stringContaining('no-such-model') });
	expect(existsSync(settingsFile())).toBe(false);
});

test('a model that is already chosen is kept, and nobody is asked', async () => {
	setReviewOverrides({ orchestratorModelId: 'claude-code:opus' });

	const pick = async (): Promise<never> => {
		throw new Error('asked for a model that was already chosen');
	};

	expect(await reviewModelStep(choice({ pick }))).toMatchObject({ state: 'unchanged', detail: 'claude-code:opus' });
});

test('with no model and nobody to ask, the step is skipped and says how to choose', async () => {
	const step = await reviewModelStep(choice());

	expect(step).toMatchObject({ state: 'skipped', fix: expect.stringContaining('--reviewer') });
	expect(existsSync(settingsFile())).toBe(false);
});
