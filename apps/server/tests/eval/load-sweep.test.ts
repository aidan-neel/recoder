import { expect, test } from 'bun:test';
import { supportedRange, type LevelResult } from '../../src/eval/load-sweep';

function level(concurrency: number, requestsPerSecond: number, extra: Partial<LevelResult> = {}): LevelResult {
	return {
		concurrency,
		requestsPerSecond,
		queueMeanMs: 0,
		queueP95Ms: 0,
		queueMaxMs: 0,
		modelWaitMs: 0,
		reviewMeanMs: 0,
		reviewMaxMs: 0,
		capacityFailures: 0,
		...extra
	};
}

test('the supported range ends at the last level that still raised throughput', () => {
	const range = supportedRange([level(1, 20), level(2, 40), level(4, 80), level(8, 81), level(16, 120)]);

	expect(range).toMatchObject({ from: 1, to: 4 });
});

test('a level that adds capacity failures ends the supported range even when throughput rose', () => {
	const range = supportedRange([level(1, 20), level(2, 40, { capacityFailures: 3 })]);

	expect(range).toMatchObject({ from: 1, to: 1 });
});

test('the model server limits the range when the next level only made requests wait inside it', () => {
	const range = supportedRange([level(8, 400), level(16, 400, { modelWaitMs: 17 })]);

	expect(range?.limitedBy).toBe('model');
});

test('the limiter cap limits the range when every level tried still raised throughput', () => {
	const range = supportedRange([level(1, 20), level(2, 40)]);

	expect(range?.limitedBy).toBe('limiter');
});
