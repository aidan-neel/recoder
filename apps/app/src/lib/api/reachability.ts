/** Who hears that the review server went quiet, or answered again after going quiet. */
type ReachabilityListener = () => void;

const lost = new Set<ReachabilityListener>();
const back = new Set<ReachabilityListener>();

/** True from a request that never reached the server until the next one it answers. */
let unreachable = false;

/** True while the last request never reached the server. */
export function isServerUnreachable(): boolean {
	return unreachable;
}

/** Calls `listener` when a request first fails to reach the server. Returns the way to stop. */
export function onServerLost(listener: ReachabilityListener): () => void {
	lost.add(listener);

	return () => lost.delete(listener);
}

/** Calls `listener` when the server answers again after a request could not reach it. Returns the way to stop. */
export function onServerBack(listener: ReachabilityListener): () => void {
	back.add(listener);

	return () => back.delete(listener);
}

/** A request never reached the server; only the first in a row tells anyone. */
export function reportUnreachable(): void {
	if (unreachable) return;

	unreachable = true;

	for (const listener of lost) listener();
}

/** The server answered, with any status; the first answer after it went quiet tells anyone. */
export function reportAnswered(): void {
	if (!unreachable) return;

	unreachable = false;

	for (const listener of back) listener();
}
