import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { HostConfig } from '../../../src/lib/reports/types';
import { reach } from '../../../src/lib/server/tunnel';

/** A fake `ssh` that logs each start and listens on the forward's local port. */
const FAKE_SSH = `#!/bin/sh
for arg; do case "$arg" in 127.0.0.1:*) spec="$arg" ;; esac; done
port=$(echo "$spec" | cut -d: -f2)
echo "$port" >> "$FAKE_SSH_LOG"
exec bun -e "require('net').createServer((s) => s.end()).listen($port, '127.0.0.1')"
`;

const dir = mkdtempSync(join(tmpdir(), 'bench-tunnel-'));
const log = join(dir, 'starts.log');
const path = process.env.PATH;
const mini = { id: 'mini', ssh: 'mini' } as HostConfig;

function starts(): number {
	return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length;
}

function children(): Set<ChildProcess> {
	return (globalThis as unknown as { benchTunnels: { children: Set<ChildProcess> } }).benchTunnels.children;
}

beforeAll(() => {
	writeFileSync(join(dir, 'ssh'), FAKE_SSH);
	chmodSync(join(dir, 'ssh'), 0o755);
	writeFileSync(log, '');
	process.env.PATH = `${dir}:${path}`;
	process.env.FAKE_SSH_LOG = log;
});

afterAll(() => {
	for (const child of children()) child.kill();
	process.env.PATH = path;
	rmSync(dir, { recursive: true, force: true });
});

test('callers that arrive together share one port forward', async () => {
	const urls = await Promise.all([1, 2, 3].map(() => reach(mini, 'http://localhost:3001')));

	expect(new Set(urls).size).toBe(1);
	expect(starts()).toBe(1);
});

test('a forward whose ssh exited is opened again', async () => {
	const first = await reach(mini, 'http://localhost:4001');
	const [child] = [...children()].filter((item) => item.spawnargs.some((arg) => arg.endsWith(':4001')));

	await new Promise((resolve) => {
		child!.once('exit', resolve);
		child!.kill();
	});

	const second = await reach(mini, 'http://localhost:4001');

	expect(second).not.toBe(first);
	expect(starts()).toBe(3);
});
