/** One step of a scripted run: what happens, and when, in ms from the start of the loop. */
export interface Beat {
	at: number;
	run: () => void;
}

/** The time source a player reads and waits on; tests pass a fake one. */
export interface Clock {
	now: () => number;
	/** Runs `run` after `ms`; returns what cancels it. */
	wait: (run: () => void, ms: number) => () => void;
}

/** A looping run that pauses in place. Play and pause are safe to call in any order and any number of times. */
interface Player {
	play: () => void;
	pause: () => void;
}

const REAL_CLOCK: Clock = {
	now: () => performance.now(),
	wait: (run, ms) => {
		const timer = setTimeout(run, ms);

		return () => clearTimeout(timer);
	}
};

/**
 * Plays `beats`, sorted by `at`, in a loop `length` ms long. Pausing keeps
 * the place in the loop and playing again carries on from it, so a beat
 * never runs twice, early or out of order. A loop that fell more than a
 * whole length behind (a throttled timer) starts over rather than racing
 * through the beats it missed.
 */
export function createPlayer(beats: readonly Beat[], length: number, clock: Clock = REAL_CLOCK): Player {
	let next = 0;
	let elapsed = 0;
	let start = 0;
	let cancel: (() => void) | null = null;

	function tick(): void {
		const at = clock.now() - start;

		while (next < beats.length && beats[next].at <= at) {
			beats[next].run();
			next += 1;
		}

		if (next === beats.length && at >= length) {
			next = 0;
			start = at >= 2 * length ? clock.now() : start + length;

			return tick();
		}

		cancel = clock.wait(tick, (next < beats.length ? beats[next].at : length) - at);
	}

	return {
		play() {
			if (cancel) return;

			start = clock.now() - elapsed;
			tick();
		},
		pause() {
			if (!cancel) return;

			cancel();
			cancel = null;
			elapsed = clock.now() - start;
		}
	};
}

/**
 * Plays while `element` is on screen and the tab is visible, and pauses
 * otherwise, so the run picks up where the visitor left it. Returns the
 * cleanup, which also pauses.
 */
export function playWhileSeen(player: Player, element: Element): () => void {
	let inView = false;

	const update = () => (inView && document.visibilityState === 'visible' ? player.play() : player.pause());

	const observer = new IntersectionObserver(([entry]) => {
		inView = entry.isIntersecting;
		update();
	});

	observer.observe(element);
	document.addEventListener('visibilitychange', update);

	return () => {
		observer.disconnect();
		document.removeEventListener('visibilitychange', update);
		player.pause();
	};
}
