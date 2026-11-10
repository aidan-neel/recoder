import { z } from 'zod';
import { MODELS_FLAGS } from '../args/flags.js';
import { parseModelsQuery } from '../args/models-args.js';
import { loadOrNotReady } from '../exit.js';
import { flagArgv, flagProperties } from './flag-arguments.js';
import { defineTool, jsonResult } from './tool.js';

/** Loads the model lists, and with them the agents and the saved model settings, only when it is called. */
export const modelsTool = defineTool({
	name: 'recoder_models',
	description: [
		'Lists the model ids that recoder_review accepts for reviewer and worker, as JSON: { reviewer, worker, models: [{ id, name, provider, efforts, defaultEffort }], problems }.',
		'reviewer and worker are the saved picks, or null. A model with no effort levels has efforts [] and defaultEffort null.',
		'OpenCode and Devin list their models by running, so a call may take up to 10 seconds; one that cannot list adds a line to problems, and the other models are still listed.',
		'provider and search narrow the list.'
	].join(' '),
	input: z.object(flagProperties(MODELS_FLAGS, [])).strict(),
	run: async (flags, { signal }) => {
		const query = parseModelsQuery(flagArgv(flags));
		const { findModels } = await loadOrNotReady(() => import('../models/models-command.js'));

		return jsonResult(await findModels(query, signal));
	}
});
