import { expect, test } from 'bun:test';
import { emptyTokenUsage, type ModelCallRow } from '@recoder/shared';
import { modelCalls } from '../../src/store';
import { modelCallsInWindow } from '../../src/storage/model-call-reads';
import { metricWrites } from '../../src/storage/persistence-queue';
import { useTempStore } from '../helpers/temp-store';

useTempStore('recoder-call-window-');

function call(at: string): ModelCallRow {
	return {
		id: crypto.randomUUID(),
		at,
		person: null,
		kind: 'other',
		ownerId: null,
		provider: 'openai-compatible',
		model: 'test',
		usage: emptyTokenUsage(),
		outcome: 'ok'
	};
}

test('a usage window includes both UTC boundary days and excludes older and future calls', async () => {
	const rows = [
		'2026-10-01T23:59:59.999Z',
		'2026-10-02T00:00:00.000Z',
		'2026-10-03T23:59:59.999Z',
		'2026-10-04T00:00:00.000Z'
	].map(call);

	for (const row of rows) await modelCalls.set(row);
	expect(await modelCallsInWindow('2026-10-02', '2026-10-03')).toEqual(rows.slice(1, 3));
	await modelCalls.clear();
});

test('a usage window drains queued writes before reading its indexed rows', async () => {
	const row = call('2026-10-02T00:00:00.000Z');

	metricWrites.for(row.id).push(async () => {
		await modelCalls.set(row);
	});

	expect(await modelCallsInWindow('2026-10-02', '2026-10-02')).toEqual([row]);
	await modelCalls.clear();
});
