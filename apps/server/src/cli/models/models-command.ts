import { EXIT, type ExitCode } from '../exit.js';
import { printResult } from '../output/print-result.js';
import { bootHeadless } from '../run/boot.js';
import { MODEL_LOOKUP_LIMIT_MS } from '../run/model-choices.js';
import { openRunSignal } from '../run/run-signal.js';
import { abortOnSignal } from '../signals/abort-on-signal.js';
import { withSpinner } from '../terminal/spinner.js';
import type { Terminal } from '../terminal/terminal.js';
import { listModels, type ModelList, type ModelsQuery } from './model-list.js';
import { modelsView } from './models-view.js';

/** `recoder models`: the accepted models, grouped for a person. A signal stops the lookup and exits as cancelled. */
export async function runModelsCommand(query: ModelsQuery, terminal: Terminal): Promise<ExitCode> {
	const signal = abortOnSignal();
	const list = await withSpinner('Listing the models', terminal, () => findModels(query, signal));

	await printResult(terminal, list, modelsView(query));

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
