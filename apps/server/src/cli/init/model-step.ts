import { isReviewConfigured, savedReviewModelId } from '../../models/models.js';
import { effectiveReviewEnv, saveReviewSettings } from '../../review/session/review-settings.js';
import { describeError } from '../exit.js';
import type { ListedModel } from '../models/model-list.js';
import { listModels } from '../models/model-list.js';
import { namedModelChoices, type ModelLookup } from '../run/model-choices.js';
import { failedStep, type InitStep } from './init-step.js';

const STEP = { id: 'review-model', label: 'Review model', path: null } as const;

const HOW_TO_CHOOSE =
	'Run recoder init on a terminal to choose one, or pass --reviewer <model id>; recoder models lists the ids.';

const NO_MODELS =
	'Sign in to Claude Code, OpenCode or Devin, or set RECODER_REVIEW_BASE_URL, RECODER_REVIEW_API_KEY and RECODER_REVIEW_MODEL, then run recoder init again.';

/** How the review model is decided when no flag names one and none is saved. */
export interface ModelChoice {
	/** The model id `--reviewer` named; null when the flag was left out. */
	requested: string | null;
	/** Asks the person to pick one of the models; null when nobody can be asked. */
	pick: ((models: readonly ListedModel[]) => Promise<ListedModel>) | null;
	/** Lists the models under a spinner or not, as the caller shows progress. */
	listing: <Result>(work: () => Promise<Result>) => Promise<Result>;
	lookup: ModelLookup;
}

/**
 * Makes sure reviews have a model to run on. A model named by `--reviewer` is checked and saved. Otherwise a model
 * that is already configured is kept, and a machine with none asks the person to pick one, when it can ask. Saving
 * writes the same settings file the app's settings do, so the pick holds for the app as well.
 */
export async function reviewModelStep(choice: ModelChoice): Promise<InitStep> {
	try {
		if (choice.requested !== null) return await saveNamedModel(choice.requested, choice.lookup);

		if (isReviewConfigured()) return { ...STEP, state: 'unchanged', detail: configuredModelName(), fix: null };

		return await pickModel(choice);
	} catch (error) {
		return failedStep(STEP, describeError(error));
	}
}

/** `namedModelChoices` throws for an id this machine does not accept, before anything is saved. */
async function saveNamedModel(id: string, lookup: ModelLookup): Promise<InitStep> {
	await namedModelChoices(id, lookup);

	return saveModel(id);
}

async function pickModel(choice: ModelChoice): Promise<InitStep> {
	if (choice.pick === null) return { ...STEP, state: 'skipped', detail: 'none is chosen yet', fix: HOW_TO_CHOOSE };

	const { models } = await choice.listing(() => listModels({ providers: null, search: null }, choice.lookup));

	if (models.length === 0) return { ...STEP, state: 'skipped', detail: 'no model is available here', fix: NO_MODELS };

	return saveModel((await choice.pick(models)).id);
}

function saveModel(id: string): InitStep {
	saveReviewSettings({ orchestratorModelId: id });

	if (!isReviewConfigured()) return failedStep(STEP, `${id} was saved, but reviews still have no model to run on`);

	return { ...STEP, state: 'done', detail: `${id}, saved`, fix: null };
}

/** The saved pick's id, or the model the environment names when nothing is saved. */
function configuredModelName(): string {
	return savedReviewModelId() ?? effectiveReviewEnv().model ?? 'configured';
}
