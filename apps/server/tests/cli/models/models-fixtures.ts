import { afterAll, afterEach, spyOn } from 'bun:test';
import type { ModelEntry } from '@recoder/shared';
import { devin } from '../../../src/agents/devin/devin';
import { opencode } from '../../../src/agents/opencode/opencode';
import { putVllmServer, removeVllmServer } from '../../../src/models/vllm/vllm-store';
import { setReviewOverrides } from '../../../src/review/session/review-settings';
import { isolateRun } from '../run/run-fixtures';

/** A token an agent's own error text holds, which no output may carry. */
export const SECRET_MARKER = 'sk-marker-3f9a';

export const OPENCODE_MODEL = 'opencode:openai/gpt-6.1-sol';

const VLLM_SERVER = 'v1';

export const VLLM_ID = `vllm:${VLLM_SERVER}/gpt-oss-20b`;

/** A captured vLLM model whose server stopped serving it, which no review accepts. */
export const GONE_VLLM_ID = `vllm:${VLLM_SERVER}/gone`;

/** A saved entry whose id starts with the Claude Code prefix, which is routed to Claude Code's list and so refused. */
export const SHADOWED_ID = 'claude-code:shadowed';

/** The two agents' listings as spies, replaced for the test file and put back after it. */
export interface AgentListings {
	opencode: ReturnType<typeof spyOn<typeof opencode, 'models'>>;
	devin: ReturnType<typeof spyOn<typeof devin, 'models'>>;
}

/**
 * Isolates the data folder and settings of each test and replaces what OpenCode and Devin list: by default both are
 * installed, OpenCode lists one model and Devin fails, with its own error text, which nothing may show. A test sets
 * `RECODER_OPENCODE_BIN` or `RECODER_DEVIN_BIN` to an empty string for an agent that is not installed.
 */
export function useAgentListings(): AgentListings {
	isolateRun();

	const listings: AgentListings = { opencode: spyOn(opencode, 'models'), devin: spyOn(devin, 'models') };

	const pins = ['RECODER_OPENCODE_BIN', 'RECODER_DEVIN_BIN'] as const;
	const before = pins.map((name) => [name, process.env[name]] as const);

	const reset = (): void => {
		for (const name of pins) process.env[name] = process.execPath;

		listings.opencode.mockReset().mockResolvedValue([openCodeEntry()]);
		listings.devin.mockReset().mockRejectedValue(new Error(`token=${SECRET_MARKER} in /home/someone/.config/devin`));
		removeVllmServer(VLLM_SERVER);
	};

	reset();

	afterEach(reset);

	afterAll(() => {
		for (const [name, value] of before) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}

		listings.opencode.mockRestore();
		listings.devin.mockRestore();
	});

	return listings;
}

/** Saves two models, picks them, captures a vLLM server, and saves a model with the Claude Code prefix. */
export function setUpModels(): void {
	setReviewOverrides({
		models: [
			{
				id: 'saved-a',
				label: 'Saved A',
				model: 'a',
				baseUrl: 'http://models.internal/v1',
				apiKey: SECRET_MARKER,
				efforts: ['low', 'high'],
				defaultEffort: 'high'
			},
			{ id: 'gpt', provider: 'codex', label: 'GPT', model: 'gpt-x' },
			{ id: SHADOWED_ID, label: 'Shadowed', model: 'shadowed' }
		],
		orchestratorModelId: 'saved-a',
		specialistModelId: 'gpt'
	});

	putVllmServer({
		id: VLLM_SERVER,
		baseUrl: 'http://127.0.0.1:8000/v1',
		syncedAt: null,
		error: null,
		models: [
			{ id: 'gpt-oss-20b', contextWindow: null, served: true },
			{ id: 'gone', contextWindow: null, served: false }
		]
	});
}

/** OpenCode's one model, with every effort. */
function openCodeEntry(): ModelEntry {
	return {
		provider: 'opencode',
		source: 'OpenAI',
		id: OPENCODE_MODEL,
		label: 'GPT 6.1 Sol',
		model: 'openai/gpt-6.1-sol',
		baseUrl: null,
		apiKeyPreview: null,
		efforts: ['low', 'medium', 'high']
	};
}
