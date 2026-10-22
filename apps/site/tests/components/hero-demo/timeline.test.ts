import { describe, expect, test } from 'bun:test';

import { createPlayer, type Clock } from '../../../src/components/hero-demo/timeline';

/** A clock that only moves when the test moves it, firing timers as their time comes. */
function fakeClock() {
	let now = 0;
	let timers: { at: number; run: () => void }[] = [];

	const clock: Clock = {
		now: () => now,
		wait(run, ms) {
			const timer = { at: now + ms, run };

			timers.push(timer);

			return () => {
				timers = timers.filter((other) => other !== timer);
			};
		}
	};

	/** Moves time forward by `ms`, firing each timer at its own time; `late` fires them all at the end instead. */
	function advance(ms: number, late = false): void {
		const end = now + ms;

		for (;;) {
			const due = timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];

			if (!due) break;

			timers = timers.filter((timer) => timer !== due);
			now = late ? end : due.at;
			due.run();
		}

		now = end;
	}

	return { clock, advance };
}

/** A run of three beats over a 1000 ms loop that notes each beat as it runs. */
function threeBeats() {
	const ran: string[] = [];
	const beats = ['a', 'b', 'c'].map((name, index) => ({ at: index * 300, run: () => ran.push(name) }));

	return { ran, beats };
}

describe('createPlayer', () => {
	test('a pause holds the place in the loop and play carries on from it without running a beat twice', () => {
		const { clock, advance } = fakeClock();
		const { ran, beats } = threeBeats();
		const player = createPlayer(beats, 1000, clock);

		player.play();
		advance(400);
		player.pause();
		player.pause();
		advance(5000);

		expect(ran).toEqual(['a', 'b']);

		player.play();
		player.play();
		advance(150);

		expect(ran).toEqual(['a', 'b']);

		advance(100);

		expect(ran).toEqual(['a', 'b', 'c']);
	});

	test('the loop starts over after its length and runs its beats again in order', () => {
		const { clock, advance } = fakeClock();
		const { ran, beats } = threeBeats();

		createPlayer(beats, 1000, clock).play();
		advance(1700);

		expect(ran).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
	});

	test('a timer that fires more than a whole loop late starts the loop over instead of racing through the missed ones', () => {
		const { clock, advance } = fakeClock();
		const { ran, beats } = threeBeats();

		createPlayer(beats, 1000, clock).play();
		advance(3500, true);

		expect(ran).toEqual(['a', 'b', 'c', 'a']);

		advance(300);

		expect(ran).toEqual(['a', 'b', 'c', 'a', 'b']);
	});
});
