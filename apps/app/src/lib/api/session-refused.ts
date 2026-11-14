/** Who hears that the server refused a request for want of a session or of the setup code. */
type RefusedListener = () => void;

const listeners = new Set<RefusedListener>();

/** Calls `listener` whenever a request is answered `401 signed-out` or `403 setup-locked`. Returns the way to stop. */
export function onSessionRefused(listener: RefusedListener): () => void {
	listeners.add(listener);

	return () => listeners.delete(listener);
}

/** Tells the app a request was refused, once for every call that was, so it reads who is signed in again. */
export function reportSessionRefused(): void {
	for (const listener of listeners) listener();
}
