import { applyTheme as apply, readTheme as read, saveTheme, type ThemeChoice } from '@recoder/shared';

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
		saveTheme(choice);
	}
}

export const theme = new Theme();
