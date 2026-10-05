import { expect, test } from 'bun:test';
import { outputRateMeter } from '../../../src/models/llm/output-rate';

/** A meter on a clock the test moves by hand. */
function meterAt(start: number) {
	const clock = { now: start };

	return { clock, meter: outputRateMeter(() => clock.now) };
}

/** Streams `chars` characters every 100ms for `ms` milliseconds; returns the last live estimate. */
function stream(clock: { now: number }, meter: ReturnType<typeof outputRateMeter>, ms: number, chars: number) {
	let rate = null;

	for (let elapsed = 0; elapsed <= ms; elapsed += 100) {
		rate = meter.add('x'.repeat(chars));
		clock.now += 100;
	}

	clock.now -= 100;

	return rate;
}

test('the clock starts at the first streamed text, not when the call began', () => {
	const { clock, meter } = meterAt(0);

	clock.now = 30_000;

	expect(stream(clock, meter, 3_000, 40)?.tokensPerSecond).toBe(100);
});

test('no live estimate until half a second of stream', () => {
	const { clock, meter } = meterAt(0);

	expect(stream(clock, meter, 400, 40)).toBeNull();
});

test('the live estimate follows the last two seconds, not the whole call', () => {
	const { clock, meter } = meterAt(0);

	stream(clock, meter, 3_000, 40);
	clock.now += 100;

	expect(stream(clock, meter, 3_000, 8)?.tokensPerSecond).toBe(20);
});

test('the provider output token count replaces the estimate when the call ends', () => {
	const { clock, meter } = meterAt(0);

	stream(clock, meter, 2_000, 40);

	expect(meter.finish(500)).toEqual({ tokensPerSecond: 250, estimated: false });
});

test('without an output token count the average comes from the streamed text', () => {
	const { clock, meter } = meterAt(0);

	stream(clock, meter, 2_000, 40);

	expect(meter.finish(null)).toEqual({ tokensPerSecond: 100, estimated: true });
});

test('a reply that arrived in one piece has no speed', () => {
	const { meter } = meterAt(0);

	meter.add('the whole reply at once');

	expect(meter.finish(12)).toBeNull();
});
