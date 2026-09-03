const STORAGE_KEY = 'recoder-theme';

/** Global light/dark theme. Mirrors the init script in `app.html`. */
class Theme {
	dark = $state(false);
	private ready = false;

	private sync(): void {
		if (typeof document === 'undefined') return;
		this.dark = document.documentElement.classList.contains('dark');
		this.ready = true;
	}

	ensureLoaded(): void {
		if (!this.ready) this.sync();
	}

	toggle(): void {
		this.ensureLoaded();
		this.dark = !this.dark;
		if (typeof document === 'undefined') return;
		document.documentElement.classList.toggle('dark', this.dark);
		try {
			localStorage.setItem(STORAGE_KEY, this.dark ? 'dark' : 'light');
		} catch {
			/* storage unavailable — theme still applies for this session */
		}
	}
}

export const theme = new Theme();
