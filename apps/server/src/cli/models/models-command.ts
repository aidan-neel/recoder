import { EXIT, type ExitCode } from '../exit.js';
import { writeJsonLine } from '../runs/json-line.js';
import { bootHeadless } from '../run/boot.js';
import { MODEL_LOOKUP_LIMIT_MS } from '../run/model-choices.js';
import { openRunSignal } from '../run/run-signal.js';
import { abortOnSignal } from '../signals/abort-on-signal.js';
import { listModels, type ModelList, type ModelsQuery } from './model-list.js';

/** `recoder models`: the accepted models as one line of JSON. A signal stops the lookup and exits as cancelled. */
export async function runModelsCommand(query: ModelsQuery): Promise<ExitCode> {
	await writeJsonLine(await findModels(query, abortOnSignal()));

	return EXIT.ok;
}

/**
 * Reads the saved settings and lists the models, as the command and the MCP tool both do. Live listings run under the
 * lookup's own limit and stop with `signal`.
 */
export async function findModels(query: ModelsQuery, signal: AbortSignal): Promise<ModelList> {
	bootHeadless();

	return listModels(query, { stop: openRunSignal(signal, null), limitMs: MODEL_LOOKUP_LIMIT_MS });
}
