import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelEntry } from '@recoder/shared';
import { devin } from '../../../src/agents/devin/devin';
import { opencode } from '../../../src/agents/opencode/opencode';
import { runDoctor } from '../../../src/cli/doctor/doctor';
import { checkReviewModel } from '../../../src/cli/doctor/model-checks';
import { getStoredSettings, setReviewOverrides } from '../../../src/review/session/review-settings';

const VARIABLES = ['RECODER_EXEC', 'RECODER_REVIEW_BASE_URL', 'RECODER_REVIEW_API_KEY', 'RECODER_REVIEW_MODEL'];

let savedDataDir = process.env.RECODER_DATA_DIR;
let savedEnv: (readonly [string, string | undefined])[] = [];
let savedSettings = getStoredSettings();

beforeEach(() => {
	savedEnv = VARIABLES.map((name) => [name, process.env[name]] as const);
	savedSettings = getStoredSettings();
	savedDataDir = process.env.RECODER_DATA_DIR;
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-doctor-'));

	for (const name of VARIABLES) delete process.env[name];
});

afterEach(() => {
	for (const [name, value] of savedEnv) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}

	setReviewOverrides(savedSettings);

	if (savedDataDir === undefined) delete process.env.RECODER_DATA_DIR;
	else process.env.RECODER_DATA_DIR = savedDataDir;
});

function configureModel(): void {
	setReviewOverrides({
		baseUrl: 'http://model.test/v1',
		apiKey: 'sk-secret-value',
		models: [{ id: 'test', label: 'Test', model: 'test-model' }]
	});
}

test('the report is not ok when a required check fails, and the fix says how to configure a model', async () => {
	setReviewOverrides({});

	const report = await runDoctor();
	const model = report.checks.find((check) => check.id === 'review-model');

	expect(report.ok).toBe(false);
	expect(model).toMatchObject({ ok: false, required: true });
	expect(model?.fix).toContain('RECODER_REVIEW_MODEL');
});

test('a sandbox that cannot run code does not make the report fail', async () => {
	configureModel();
	process.env.RECODER_EXEC = 'off';

	const report = await runDoctor();
	const sandbox = report.checks.find((check) => check.id === 'sandbox');

	expect(sandbox).toMatchObject({ ok: false, required: false });
	expect(report.ok).toBe(true);
});

test('no check leaks a key and the model check names both models', async () => {
	configureModel();

	const report = await runDoctor();

	expect(JSON.stringify(report)).not.toContain('sk-secret-value');

	expect(report.checks.find((check) => check.id === 'review-model')?.detail).toBe(
		'Review model test-model; worker model test-model.'
	);
});

const OPENCODE_ID = 'opencode:openai/gpt-6';

const DEVIN_ID = 'devin:swe-2-high';

const SECRET_MARKER = 'sk-marker-7c1d';

function entry(id: string): ModelEntry {
	return { id, label: id, model: id.slice(id.indexOf(':') + 1), baseUrl: null, apiKeyPreview: null };
}

test('an OpenCode model its agent does not list fails the model check, and the fix says how to sign in', async () => {
	setReviewOverrides({ orchestratorModelId: OPENCODE_ID });

	const listModels = spyOn(opencode, 'models').mockResolvedValue([entry('opencode:anthropic/claude')]);

	try {
		const check = await checkReviewModel();

		expect(check).toMatchObject({ id: 'review-model', ok: false, required: true });
		expect(check.detail).toContain(OPENCODE_ID);
		expect(check.fix).toContain('opencode auth login');
	} finally {
		listModels.mockRestore();
	}
});

test('an OpenCode model its agent lists passes the model check', async () => {
	setReviewOverrides({ orchestratorModelId: OPENCODE_ID });

	const listModels = spyOn(opencode, 'models').mockResolvedValue([entry(OPENCODE_ID)]);

	try {
		expect(await checkReviewModel()).toMatchObject({ ok: true, fix: null });
	} finally {
		listModels.mockRestore();
	}
});

test('an OpenCode that cannot list its models fails the model check without its own error text', async () => {
	setReviewOverrides({ orchestratorModelId: OPENCODE_ID });

	const listModels = spyOn(opencode, 'models').mockRejectedValue(new Error(`token=${SECRET_MARKER}`));

	try {
		const check = await checkReviewModel();

		expect(check.ok).toBe(false);
		expect(JSON.stringify(check)).not.toContain(SECRET_MARKER);
	} finally {
		listModels.mockRestore();
	}
});

test('a Devin model its agent does not list fails the model check', async () => {
	setReviewOverrides({ orchestratorModelId: DEVIN_ID });

	const listModels = spyOn(devin, 'models').mockResolvedValue([entry('devin:other')]);

	try {
		const check = await checkReviewModel();

		expect(check).toMatchObject({ ok: false });
		expect(check.fix).toContain('devin auth login');
	} finally {
		listModels.mockRestore();
	}
});
