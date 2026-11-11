import { expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenCodeServer } from '../../../src/agents/opencode/opencode-server';
import { whenFileExists } from '../../helpers/when-found';

const STARTED_MARK = 'started';

/** An `opencode` that answers `--version`, marks that `serve` started, and then never prints its address. */
async function stalledOpenCode(folder: string): Promise<string> {
	const binary = join(folder, 'opencode');
	const mark = join(folder, STARTED_MARK);

	await writeFile(
		binary,
		`#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.0.0; exit 0; fi\ntouch "${mark}"\nexec sleep 600\n`
	);

	await chmod(binary, 0o755);

	return binary;
}

test('stop ends a server that is still starting', async () => {
	const folder = await mkdtemp(join(tmpdir(), 'recoder-opencode-'));
	const server = new OpenCodeServer({ ...process.env, RECODER_OPENCODE_BIN: await stalledOpenCode(folder) });
	const starting = server.ensure();

	await whenFileExists(join(folder, STARTED_MARK));
	server.stop();

	await expect(starting).rejects.toThrow();
	await rm(folder, { recursive: true });
});
