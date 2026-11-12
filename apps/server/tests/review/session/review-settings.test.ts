import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configForOrchestrator } from '../../../src/models/models';
import {
	effectiveSubagentCap,
	getStoredSettings,
	initReviewSettings,
	saveReviewSettings,
	setConnection,
	setReviewOverrides
} from '../../../src/review/session/review-settings';

const originalDataDir = process.env.RECODER_DATA_DIR;

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-settings-'));
	setReviewOverrides({});
});

afterEach(() => {
	process.env.RECODER_DATA_DIR = originalDataDir;
	setReviewOverrides({});
});

test('a hosted provider key and its models survive a restart', () => {
	setConnection('opencode-go', 'sk-go-123');

	saveReviewSettings({
		models: [{ id: 'go:glm', source: 'opencode-go', label: 'GLM-5.2', model: 'glm-5.2', contextWindow: 1_000_000 }]
	});

	setReviewOverrides({});
	initReviewSettings();
	expect(getStoredSettings().connections).toEqual({ 'opencode-go': { apiKey: 'sk-go-123' } });
	expect(getStoredSettings().models?.[0]).toMatchObject({ source: 'opencode-go', contextWindow: 1_000_000 });

	expect(configForOrchestrator()).toMatchObject({
		baseUrl: 'https://opencode.ai/zen/go/v1',
		apiKey: 'sk-go-123',
		model: 'glm-5.2',
		source: 'opencode-go'
	});
});

test('disconnecting a provider removes its models and the picks that pointed at them', () => {
	setConnection('opencode-go', 'sk-go-123');

	saveReviewSettings({
		models: [
			{ id: 'go:glm', source: 'opencode-go', label: 'GLM-5.2', model: 'glm-5.2' },
			{ id: 'local', label: 'Local', model: 'qwen', baseUrl: 'http://localhost:8000/v1' }
		],
		orchestratorModelId: 'go:glm'
	});

	setConnection('opencode-go', null);
	expect(getStoredSettings().models?.map((entry) => entry.id)).toEqual(['local']);
	expect(getStoredSettings().orchestratorModelId).toBeUndefined();
});

test('a subagent cap saved before the caps were 3, 8 and 12 loads as the nearest cap that is as generous and is saved that way', () => {
	const file = join(process.env.RECODER_DATA_DIR!, 'review-config.json');

	for (const [saved, cap] of [
		[2, 3],
		[4, 8],
		[0, 0],
		[12, 12],
		['uncapped', 'uncapped']
	] as const) {
		writeFileSync(file, JSON.stringify({ subagentCap: saved }));
		setReviewOverrides({});
		initReviewSettings();
		expect(effectiveSubagentCap()).toBe(cap);
		expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ subagentCap: cap });
	}
});

test('an old dispatch level loads as its subagent cap, is saved that way and survives a restart', () => {
	const file = join(process.env.RECODER_DATA_DIR!, 'review-config.json');

	for (const [specialistDispatch, cap] of [
		['low', 0],
		['medium', 3],
		['high', 8]
	] as const) {
		writeFileSync(file, JSON.stringify({ specialistDispatch }));
		setReviewOverrides({});
		initReviewSettings();
		expect(effectiveSubagentCap()).toBe(cap);
		expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ subagentCap: cap });
		setReviewOverrides({});
		initReviewSettings();
		expect(effectiveSubagentCap()).toBe(cap);
	}
});

test('saving the models list keeps OpenCode, Claude Code, Devin and vLLM picks while dropping a deleted HTTP model', () => {
	const kept = { id: 'local', label: 'Local', model: 'qwen', baseUrl: 'http://localhost:8000/v1' };
	const removed = { id: 'gone', label: 'Gone', model: 'gone', baseUrl: 'http://localhost:8001/v1' };

	saveReviewSettings({
		models: [kept, removed],
		sharedModelId: 'opencode:openrouter/deepseek/deepseek-r1',
		orchestratorModelId: 'claude-code:claude-sonnet-4-5',
		specialistModelId: 'devin:claude-opus-4-1',
		verifierModelId: 'vllm:srv1/Qwen/Qwen2.5-Coder-32B'
	});

	saveReviewSettings({ models: [kept] });

	expect(getStoredSettings()).toMatchObject({
		sharedModelId: 'opencode:openrouter/deepseek/deepseek-r1',
		orchestratorModelId: 'claude-code:claude-sonnet-4-5',
		specialistModelId: 'devin:claude-opus-4-1',
		verifierModelId: 'vllm:srv1/Qwen/Qwen2.5-Coder-32B'
	});

	saveReviewSettings({
		sharedModelId: 'gone',
		orchestratorModelId: 'gone',
		specialistModelId: 'gone',
		verifierModelId: 'gone'
	});

	saveReviewSettings({ models: [kept] });

	expect(getStoredSettings().sharedModelId).toBeUndefined();
	expect(getStoredSettings().orchestratorModelId).toBeUndefined();
	expect(getStoredSettings().specialistModelId).toBeUndefined();
	expect(getStoredSettings().verifierModelId).toBeUndefined();
});

test('verifierModelId and verifierEffort survive a restart and can be cleared back to the Review model', () => {
	saveReviewSettings({
		models: [
			{ id: 'lead', label: 'Lead', model: 'lead', baseUrl: 'http://localhost:8000/v1' },
			{ id: 'judge', label: 'Judge', model: 'judge', baseUrl: 'http://localhost:8000/v1' }
		],
		orchestratorModelId: 'lead',
		verifierModelId: 'judge',
		verifierEffort: 'high'
	});

	setReviewOverrides({});
	initReviewSettings();

	expect(getStoredSettings()).toMatchObject({
		orchestratorModelId: 'lead',
		verifierModelId: 'judge',
		verifierEffort: 'high'
	});

	saveReviewSettings({ verifierModelId: null, verifierEffort: null });
	setReviewOverrides({});
	initReviewSettings();

	expect(getStoredSettings().verifierModelId).toBeNull();
	expect(getStoredSettings().verifierEffort).toBeNull();
	expect(configForOrchestrator().model).toBe('lead');
});
