/** Currently selected file in the session sidebar. Shared by the tree and diff view. */
class SessionFileState {
	currentId = $state('src/rate-limit/limiter.ts');

	select(id: string): void {
		this.currentId = id;
	}
}

export const sessionFile = new SessionFileState();
