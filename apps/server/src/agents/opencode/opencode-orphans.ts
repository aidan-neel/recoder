import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { serverDataDir } from '../../util/data-dir';

/** A started `opencode serve`, and the server process that started it. */
const serveRecord = z.object({ owner: z.number().int().positive(), pid: z.number().int().positive() });

type ServeRecord = z.infer<typeof serveRecord>;

/**
 * The serve processes this module instance started. `bun --watch` reloads the server inside the same process, so
 * a record owned by this process but not listed here was left by an instance before a reload.
 */
const startedHere = new Set<number>();

/**
 * Notes a started `opencode serve` on disk. Each one holds about 230 MB, and one left by an instance before a
 * `bun --watch` reload, or by a server that crashed, keeps running with nothing to stop it.
 */
export function recordServe(pid: number): void {
	startedHere.add(pid);
	writeFileSync(recordPath(pid), JSON.stringify({ owner: process.pid, pid } satisfies ServeRecord));
}

/** Forgets a serve process that ended. */
export function forgetServe(pid: number): void {
	startedHere.delete(pid);
	rmSync(recordPath(pid), { force: true });
}

/**
 * Stops each recorded serve process that an instance before a reload, or a server that no longer runs, left
 * behind, and forgets it. A record whose pid now belongs to another program is only forgotten.
 */
export function stopOrphanedServes(): void {
	for (const record of readRecords()) {
		if (record.owner === process.pid && startedHere.has(record.pid)) continue;
		if (record.owner !== process.pid && isRunning(record.owner)) continue;

		if (isOpenCodeServe(record.pid)) process.kill(record.pid);
		forgetServe(record.pid);
	}
}

function recordsDir(): string {
	const dir = join(serverDataDir(), 'opencode-serve');

	mkdirSync(dir, { recursive: true });

	return dir;
}

function recordPath(pid: number): string {
	return join(recordsDir(), `${pid}.json`);
}

/** The records on disk; one that cannot be read is dropped, since nothing it names can be checked. */
function readRecords(): ServeRecord[] {
	return readdirSync(recordsDir()).flatMap((name) => {
		const path = join(recordsDir(), name);

		const record = serveRecord.safeParse(parseJson(readFileSync(path, 'utf8')));

		if (record.success) return [record.data];

		rmSync(path, { force: true });

		return [];
	});
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch (error) {
		if (error instanceof SyntaxError) return null;
		throw error;
	}
}

/** Whether a process with this pid exists; signal 0 checks without sending anything, and EPERM means it exists. */
function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);

		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
		if ((error as NodeJS.ErrnoException).code === 'EPERM') return true;
		throw error;
	}
}

/** Whether the pid is still an `opencode serve`, so a pid the system gave to another program is never stopped. */
function isOpenCodeServe(pid: number): boolean {
	if (!isRunning(pid)) return false;

	const listed = Bun.spawnSync(['ps', '-o', 'args=', '-p', String(pid)]);
	const args = listed.stdout.toString();

	return args.includes('opencode') && / serve\b/.test(args);
}
