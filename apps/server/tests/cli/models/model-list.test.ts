import { expect, spyOn, test } from 'bun:test';
import { customCommand } from '../../../src/agents/custom/custom-command';
import { EXIT } from '../../../src/cli/exit';
import { listModels, type ModelsQuery } from '../../../src/cli/models/model-list';
import { MODEL_LOOKUP_LIMIT_MS, namedModelChoices, type ModelLookup } from '../../../src/cli/run/model-choices';
import { openRunSignal } from '../../../src/cli/run/run-signal';
import { unstoppedLookup } from '../run/run-fixtures';
import {
	GONE_VLLM_ID,
	OPENCODE_MODEL,
	SECRET_MARKER,
	SHADOWED_ID,
	VLLM_ID,
	setUpModels,
	useAgentListings
} from './models-fixtures';

const LOOKUP = unstoppedLookup(MODEL_LOOKUP_LIMIT_MS);

const EVERYTHING: ModelsQuery = { providers: null, search: null };

const agents = useAgentListings();

test('the models listed are the ones --reviewer accepts, with the efforts it would offer', async () => {
	setUpModels();

	const { models } = await listModels(EVERYTHING, LOOKUP);

	expect(models.map((model) => model.id)).toContain(VLLM_ID);

	for (const model of models) {
		const choices = await namedModelChoices(model.id, LOOKUP);

		expect(model).toMatchObject({ efforts: choices.efforts ?? [], defaultEffort: choices.defaultEffort });
	}
});

test('a model that is not listed is refused by --reviewer', async () => {
	setUpModels();

	const { models } = await listModels(EVERYTHING, LOOKUP);
	const refused = [SHADOWED_ID, GONE_VLLM_ID, 'claude-code:nope', 'opencode:openai/missing'];

	for (const id of refused) {
		expect(models.map((model) => model.id)).not.toContain(id);
		await expect(namedModelChoices(id, LOOKUP)).rejects.toMatchObject({ exitCode: EXIT.usage });
	}
});

test('each model is grouped under the provider the app picker names, A to Z, with the saved picks beside the list', async () => {
	setUpModels();

	const list = await listModels(EVERYTHING, LOOKUP);
	const providers = [...new Set(list.models.map((model) => model.provider))];

	expect(providers).toEqual(['ChatGPT', 'Claude Code', 'models.internal', 'OpenAI', 'vLLM · 127.0.0.1:8000']);

	expect(list.models.find((model) => model.id === 'saved-a')).toMatchObject({
		name: 'Saved A',
		provider: 'models.internal',
		efforts: ['low', 'high'],
		defaultEffort: 'high'
	});

	expect(list.models.find((model) => model.id === 'gpt')).toMatchObject({ efforts: [], defaultEffort: null });
	expect(list).toMatchObject({ reviewer: 'saved-a', worker: 'gpt' });
});

test('an agent that cannot list becomes one problem line with none of its own error text, and the rest is still listed', async () => {
	setUpModels();

	const list = await listModels(EVERYTHING, LOOKUP);

	expect(list.problems).toEqual(['Devin could not list its models']);
	expect(JSON.stringify(list)).not.toContain(SECRET_MARKER);
	expect(list.models.map((model) => model.id)).toContain(OPENCODE_MODEL);
});

test('an agent that is not installed is not asked and adds no model and no problem', async () => {
	process.env.RECODER_OPENCODE_BIN = '';
	process.env.RECODER_DEVIN_BIN = '';

	const { models, problems } = await listModels(EVERYTHING, LOOKUP);

	expect(problems).toEqual([]);
	expect(models.map((model) => model.id)).not.toContain(OPENCODE_MODEL);
	expect(agents.opencode).not.toHaveBeenCalled();
	expect(agents.devin).not.toHaveBeenCalled();
});

test('a model named for an agent that is not installed is refused as not ready, and the agent is not asked', async () => {
	process.env.RECODER_OPENCODE_BIN = '';

	await expect(namedModelChoices(OPENCODE_MODEL, LOOKUP)).rejects.toMatchObject({ exitCode: EXIT.notReady });
	expect(agents.opencode).not.toHaveBeenCalled();
});

test('an agent that is too slow to list becomes a problem line naming the limit', async () => {
	agents.opencode.mockReturnValue(new Promise(() => {}));

	const { problems } = await listModels(EVERYTHING, unstoppedLookup(0));

	expect(problems).toContain('OpenCode did not list its models within 0 s');
});

test('a stop during a live listing ends the lookup as cancelled', async () => {
	const controller = new AbortController();
	const lookup: ModelLookup = { stop: openRunSignal(controller.signal, null), limitMs: MODEL_LOOKUP_LIMIT_MS };

	agents.opencode.mockImplementation(() => {
		controller.abort();

		return new Promise(() => {});
	});

	await expect(listModels(EVERYTHING, lookup)).rejects.toMatchObject({ exitCode: EXIT.cancelled });
});

test('--provider keeps the models of those providers, ignoring case', async () => {
	setUpModels();

	const { models } = await listModels({ providers: ['claude code', 'OPENAI'], search: null }, LOOKUP);

	expect(new Set(models.map((model) => model.provider))).toEqual(new Set(['Claude Code', 'OpenAI']));
});

test('--search keeps the models whose id or name contains the text, ignoring case', async () => {
	setUpModels();

	const byId = await listModels({ providers: null, search: 'GPT-OSS' }, LOOKUP);
	const byName = await listModels({ providers: null, search: 'haiku 4.5' }, LOOKUP);

	expect(byId.models.map((model) => model.id)).toEqual([VLLM_ID]);
	expect(byName.models.map((model) => model.id)).toEqual(['claude-code:claude-haiku-4-5-20251001']);
});

test('a provider no model has is a usage error that names the providers and the agent that could not list', async () => {
	setUpModels();

	const failure = await listModels({ providers: ['Nowhere'], search: null }, LOOKUP).catch((error: unknown) => error);

	expect(failure).toMatchObject({ exitCode: EXIT.usage });
	expect(String(failure)).toContain('"Nowhere"');
	expect(String(failure)).toContain('Claude Code');
	expect(String(failure)).toContain('Devin could not list its models');
});

test('a machine with nothing set up still lists the Claude Code models', async () => {
	agents.opencode.mockResolvedValue([]);

	const list = await listModels(EVERYTHING, LOOKUP);

	expect(list).toMatchObject({ reviewer: null, worker: null });
	expect(new Set(list.models.map((model) => model.provider))).toEqual(new Set(['Claude Code']));
});

test('a model of a configured custom command is accepted by --reviewer once the command lists it', async () => {
	process.env.RECODER_CUSTOM_AGENT = JSON.stringify({ argv: [process.execPath] });

	const deep = { id: 'custom-command:deep', label: 'Deep', model: 'deep', baseUrl: null, apiKeyPreview: null };
	const listing = spyOn(customCommand, 'models').mockResolvedValue([{ ...deep, efforts: ['low', 'high'] }]);

	try {
		expect(await namedModelChoices(deep.id, LOOKUP)).toEqual({ efforts: ['low', 'high'], defaultEffort: null });
	} finally {
		listing.mockRestore();
		delete process.env.RECODER_CUSTOM_AGENT;
	}
});
