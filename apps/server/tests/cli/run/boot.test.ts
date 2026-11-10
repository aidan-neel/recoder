import { expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bootHeadless } from '../../../src/cli/run/boot';
import { effectiveSubagentCap, setReviewOverrides } from '../../../src/review/session/review-settings';
import { isolateRun } from './run-fixtures';

isolateRun();

test('a settings file in an old format is read in the current shape and left exactly as it was', () => {
	const file = join(process.env.RECODER_DATA_DIR ?? '', 'review-config.json');
	const old = JSON.stringify({ specialistDispatch: 'high' });

	writeFileSync(file, old);
	setReviewOverrides({});

	bootHeadless();

	expect(effectiveSubagentCap()).toBe(8);
	expect(readFileSync(file, 'utf8')).toBe(old);
});
