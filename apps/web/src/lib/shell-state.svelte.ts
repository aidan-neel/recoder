import type { Provider } from '@recoder/shared';
import { serverApi } from './server-api';

interface Account {
	user: string;
	provider: Provider;
}

interface Usage {
	name: string;
	percent: number;
	resetsAt: number | null;
}

/** App-shell data: signed-in account, subscription usage, and the ⌘K palette. */
class ShellState {
	account = $state<Account | null>(null);
	usage = $state<Usage | null>(null);
	paletteOpen = $state(false);
	usageOpen = $state(false);
	private loaded = false;

	load(): void {
		if (this.loaded) return;
		this.loaded = true;
		void serverApi
			.authStatus()
			.then((status) => {
				const signedIn = status.github.authenticated ? status.github : status.gitlab.authenticated ? status.gitlab : null;
				this.account = signedIn?.user ? { user: signedIn.user, provider: signedIn.provider } : null;
			})
			.catch(() => {
				this.account = null;
			});
		void this.refreshUsage();
	}

	async refreshUsage(): Promise<void> {
		try {
			const status = await serverApi.getCodexStatus();
			const limit = status.authenticated ? status.limits?.[0] : undefined;
			this.usage =
				limit && Number.isFinite(limit.usedPercent)
					? { name: limit.name, percent: Math.max(0, Math.min(100, Math.round(limit.usedPercent))), resetsAt: limit.resetsAt }
					: null;
		} catch {
			this.usage = null;
		}
	}
}

export const shellState = new ShellState();

/** "aidan-neel" → "AN". */
export function initials(name: string): string {
	const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
	const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
	return letters.toUpperCase();
}
