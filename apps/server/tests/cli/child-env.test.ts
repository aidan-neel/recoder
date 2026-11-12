import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_BIN_PINS } from '../helpers/agent-bins';
import { childEnvironment } from './child-env';

test('a process a test starts gets every agent binary pin blanked', () => {
	const env = childEnvironment(mkdtempSync(join(tmpdir(), 'child-env-')));

	for (const pin of AGENT_BIN_PINS) expect(env[pin]).toBe('');
});
