import { afterEach, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setReviewOverrides } from '../../src/review/session/review-settings';

const ENV_KEYS = ['RECODER_REVIEW_BASE_URL', 'RECODER_REVIEW_API_KEY', 'RECODER_REVIEW_MODEL', 'RECODER_DATA_DIR'];

/** Points the server at a new, empty data dir. */
export function isolateDataDir(): void {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-settings-'));
}

/** Gives each test of the file its own data dir, and puts the review env and overrides back after it. */
export function isolateSettings(): void {
	const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

	beforeEach(isolateDataDir);

	afterEach(() => {
		for (const key of ENV_KEYS) {
			if (savedEnv[key] === undefined) delete process.env[key];
			else process.env[key] = savedEnv[key];
		}

		setReviewOverrides({});
	});
}
