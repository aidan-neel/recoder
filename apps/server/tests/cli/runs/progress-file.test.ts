import { afterEach, expect, test } from 'bun:test';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProgressFileReader } from '../../../src/cli/runs/progress-file';

const AT = '2026-11-10T10:00:00.000Z';

const folders: string[] = [];

afterEach(() => {
	for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function progressFile(): string {
	const folder = mkdtempSync(join(tmpdir(), 'recoder-progress-'));

	folders.push(folder);

	return join(folder, 'progress.ndjson');
}

const stageLine = (stage: string): string => `${JSON.stringify({ at: AT, type: 'stage', stage })}\n`;

test('a file that does not exist yet has no events, and is read once it appears', async () => {
	const path = progressFile();
	const reader = new ProgressFileReader(path);

	expect(await reader.readNew()).toEqual([]);

	appendFileSync(path, stageLine('checkout'));

	expect(await reader.readNew()).toEqual([{ at: Date.parse(AT), event: { type: 'stage', stage: 'checkout' } }]);
});

test('each read returns only what was written since the last one', async () => {
	const path = progressFile();
	const reader = new ProgressFileReader(path);

	appendFileSync(path, stageLine('checkout'));
	await reader.readNew();
	appendFileSync(path, stageLine('reviewing'));

	expect((await reader.readNew()).map(({ event }) => event)).toEqual([{ type: 'stage', stage: 'reviewing' }]);
	expect(await reader.readNew()).toEqual([]);
});

test('a line that is still being written is held back until its end arrives', async () => {
	const path = progressFile();
	const reader = new ProgressFileReader(path);
	const line = stageLine('verify');

	appendFileSync(path, line.slice(0, 20));

	expect(await reader.readNew()).toEqual([]);

	appendFileSync(path, line.slice(20));

	expect(await reader.readNew()).toHaveLength(1);
});

test('a line that is not an event is skipped and the lines around it are still read', async () => {
	const path = progressFile();

	appendFileSync(path, `${stageLine('checkout')}not json\n{"type":"stage","stage":"made-up"}\n${stageLine('verify')}`);

	const events = await new ProgressFileReader(path).readNew();

	expect(events.map(({ event }) => event)).toEqual([
		{ type: 'stage', stage: 'checkout' },
		{ type: 'stage', stage: 'verify' }
	]);
});
