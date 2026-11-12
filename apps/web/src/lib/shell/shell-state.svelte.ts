import type { Provider } from '@recoder/shared';
import { serverApi } from '../api/server-api';

interface Account {
	user: string;
	provider: Provider;
}

/** App-shell data: signed-in account and the ⌘K palette. */
class ShellState {
	account = $state<Account | null>(null);
	paletteOpen = $state(false);
	private loaded = false;

	load(): void {
		if (this.loaded) return;
		this.loaded = true;

		void serverApi
			.authStatus()
			.then((status) => {
				const signedIn = status.github.authenticated
					? status.github
					: status.gitlab.authenticated
						? status.gitlab
						: null;

				this.account = signedIn?.user ? { user: signedIn.user, provider: signedIn.provider } : null;
			})
			.catch(() => {
				this.account = null;
			});
	}
}

export const shellState = new ShellState();
