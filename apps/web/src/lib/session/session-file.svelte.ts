/** Default file for mock/demo sessions (reset on every session switch). */
export const DEFAULT_FILE = 'src/rate-limit/limiter.ts';

/** Currently selected file in the session sidebar. Shared by the tree and diff view. */
class SessionFileState {
	currentId = $state(DEFAULT_FILE);

	select(id: string): void {
		this.currentId = id;
	}
}

export const sessionFile = new SessionFileState();
