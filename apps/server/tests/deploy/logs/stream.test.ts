import { expect, test } from 'bun:test';
import { readServerLogs, serverLog } from '../../../src/deploy/logs/stream';

test('the log pager redacts credentials before storing lines and advances without duplicates', () => {
	serverLog('info', 'ready');
	serverLog('warn', 'updater unavailable');
	serverLog('info', 'api_key=fixture-value');

	const page = readServerLogs({ limit: 1, level: 'info' });

	expect(page.lines.map((line) => line.message)).toEqual(['api_key=[redacted]']);
	expect(page.before).toBe(page.lines[0].seq);
	expect(readServerLogs({ limit: 1, level: 'info', before: page.before! }).lines[0].message).toBe('ready');
});
