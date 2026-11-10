import { expect, test } from 'bun:test';
import { existsSync, watch } from 'node:fs';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenCodeServer } from '../../../src/agents/opencode/opencode-server';

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

/** Resolves once `serve` has started, from a change in the folder and not from a timer. */
function serveStarted(folder: string): Promise<void> {
	return new Promise((resolve) => {
		const watcher = watch(folder, () => {
			if (!existsSync(join(folder, STARTED_MARK))) return;

			watcher.close();
			resolve();
		});
	});
}

test('stop ends a server that is still starting', async () => {
	const folder = await mkdtemp(join(tmpdir(), 'recoder-opencode-'));
	const server = new OpenCodeServer({ ...process.env, RECODER_OPENCODE_BIN: await stalledOpenCode(folder) });
	const started = serveStarted(folder);
	const starting = server.ensure();

	await started;
	server.stop();

	await expect(starting).rejects.toThrow();
	await rm(folder, { recursive: true });
});
