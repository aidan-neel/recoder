import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const RECHECK_MS = 5;

/**
 * Resolves with what `find` finds, asking again every few milliseconds until it finds something. The answer does not
 * depend on the interval; a test that never finds anything ends on its own time limit, or on `deadline` it fails
 * there with a message that names what never appeared.
 *
 * It asks on a timer and not on `fs.watch` events. In the whole suite on Bun 1.3.14, a watch that started as another
 * process made the awaited change reported nothing in about 1 run in 10, and the test then waited for ever.
 */
export async function whenFound<T>(
	find: () => T | null | Promise<T | null>,
	deadline?: { afterMs: number; waitingFor: string }
): Promise<T> {
	const giveUpAt = deadline === undefined ? null : Date.now() + deadline.afterMs;

	for (;;) {
		const found = await find();

		if (found !== null) return found;

		const expired = giveUpAt !== null && Date.now() >= giveUpAt;

		if (expired) throw new Error(`Gave up after ${deadline?.afterMs}ms waiting for ${deadline?.waitingFor}.`);

		await delay(RECHECK_MS);
	}
}

/** Resolves once the file exists. */
export async function whenFileExists(path: string): Promise<void> {
	await whenFound(() => (existsSync(path) ? true : null));
}
