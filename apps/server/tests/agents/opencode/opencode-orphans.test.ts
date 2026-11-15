import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forgetServe, recordServe, stopOrphanedServes } from '../../../src/agents/opencode/opencode-orphans';

const started: Bun.Subprocess[] = [];

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-orphans-'));
});

afterEach(() => {
	for (const proc of started.splice(0)) proc.kill();
});

/** A process `ps` lists as `opencode … serve`, standing in for a real server. */
function fakeServe(): Bun.Subprocess {
	return track(Bun.spawn(['bash', '-c', 'exec -a opencode bash -c "sleep 30; :" serve']));
}

function track(proc: Bun.Subprocess): Bun.Subprocess {
	started.push(proc);

	return proc;
}

/** Writes a record as another server instance would have, owned by `owner`. */
function recordFor(owner: number, pid: number): string {
	const dir = join(process.env.RECODER_DATA_DIR ?? '', 'opencode-serve');
	const path = join(dir, `${pid}.json`);

	mkdirSync(dir, { recursive: true });
	writeFileSync(path, JSON.stringify({ owner, pid }));

	return path;
}

/** Nothing stopped it: no exit code and no signal. */
function isRunning(proc: Bun.Subprocess): boolean {
	return proc.exitCode === null && proc.signalCode === null;
}

test('a serve process left by an instance of this server before a reload is stopped', async () => {
	const leftover = fakeServe();
	const record = recordFor(process.pid, leftover.pid);

	stopOrphanedServes();

	await leftover.exited;

	expect(leftover.signalCode).toBe('SIGTERM');
	expect(existsSync(record)).toBe(false);
});

test('the serve process this instance started is left running', async () => {
	const own = fakeServe();

	recordServe(own.pid);
	stopOrphanedServes();

	expect(isRunning(own)).toBe(true);

	forgetServe(own.pid);
});

test('a serve process another running server owns is left running', async () => {
	const owner = track(Bun.spawn(['sleep', '30']));
	const theirs = fakeServe();

	recordFor(owner.pid, theirs.pid);
	stopOrphanedServes();

	expect(isRunning(theirs)).toBe(true);
});

test('a recorded pid that now belongs to another program is forgotten without stopping it', async () => {
	const other = track(Bun.spawn(['sleep', '30']));
	const record = recordFor(process.pid, other.pid);

	stopOrphanedServes();

	expect(isRunning(other)).toBe(true);
	expect(existsSync(record)).toBe(false);
});
