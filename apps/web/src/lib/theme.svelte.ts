export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'recoder-theme';
const CHROME = { light: '#ebe8e2', dark: '#0d0c0b' };

function read(): ThemeChoice {
	try {
		const saved = localStorage.getItem(KEY);

		if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
	} catch {}

	return 'system';
}

function resolve(choice: ThemeChoice): 'light' | 'dark' {
	if (choice !== 'system') return choice;

	return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function apply(choice: ThemeChoice): void {
	const mode = resolve(choice);
	const root = document.documentElement;

	root.classList.toggle('dark', mode === 'dark');
	root.style.colorScheme = mode;
	document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', mode);
	document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[mode]);
}

class Theme {
	choice = $state<ThemeChoice>('dark');

	/** Read the saved choice and follow the system while it is "system". */
	init(): void {
		this.choice = read();
		apply(this.choice);

		matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
			if (this.choice === 'system') apply('system');
		});
	}

	set(choice: ThemeChoice): void {
		this.choice = choice;

		try {
			localStorage.setItem(KEY, choice);
		} catch {}

		apply(choice);
	}
}

export const theme = new Theme();
