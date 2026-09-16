const STORAGE_KEY = 'recoder.sidebar.collapsed';

function loadCollapsed(): boolean {
	try {
		if (typeof localStorage === 'undefined') return false;
		return localStorage.getItem(STORAGE_KEY) === '1';
	} catch {
		return false;
	}
}

class AppSidebarState {
	/** Desktop icon-rail mode. Persisted across restarts. */
	collapsed = $state(false);
	/** Mobile drawer. */
	mobileOpen = $state(false);

	constructor() {
		this.collapsed = loadCollapsed();
	}

	toggleCollapsed(): void {
		this.collapsed = !this.collapsed;
		try {
			if (typeof localStorage === 'undefined') return;
			localStorage.setItem(STORAGE_KEY, this.collapsed ? '1' : '0');
		} catch {
			// Storage full or unavailable — collapse just won't survive refresh.
		}
	}

	closeMobile(): void {
		this.mobileOpen = false;
	}
}

export const appSidebarState = new AppSidebarState();
