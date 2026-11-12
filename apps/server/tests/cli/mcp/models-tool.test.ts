import { afterEach, expect, test } from 'bun:test';
import { OPENCODE_MODEL, SECRET_MARKER, setUpModels, useAgentListings } from '../models/models-fixtures';
import { useFreshDataDir } from '../runs/run-fixtures';
import { callTool, TestProcesses } from './server-harness';

const processes = new TestProcesses();

afterEach(() => processes.reset());

useFreshDataDir();

useAgentListings();

test('recoder_models returns the same list as recoder models, with the agent that failed named as a problem', async () => {
	setUpModels();

	const { text, isError } = await callTool('recoder_models', {}, processes);
	const list = JSON.parse(text);

	expect(isError).toBe(false);
	expect(list).toMatchObject({ reviewer: 'saved-a', worker: 'gpt', problems: ['Devin could not list its models'] });
	expect(list.models.map((model: { id: string }) => model.id)).toContain(OPENCODE_MODEL);
	expect(text).not.toContain(SECRET_MARKER);
});

test('recoder_models takes provider and search as the command takes its flags', async () => {
	setUpModels();

	const { text } = await callTool('recoder_models', { provider: ['openai,gpt.example'], search: 'sol' }, processes);

	expect(JSON.parse(text).models.map((model: { id: string }) => model.id)).toEqual([OPENCODE_MODEL]);
});

test('recoder_models with a provider no model has is a tool error naming the providers', async () => {
	const { text, isError } = await callTool('recoder_models', { provider: ['Nowhere'] }, processes);

	expect(isError).toBe(true);
	expect(text).toContain('Claude Code');
});
