import type { ReactNode } from 'react';

import { Page } from '@/components/common/page';

interface SettingsPageProps {
	/** The page's name in the bar: "Automations". */
	name: string;
	children: ReactNode;
}

/**
 * A page of titled setting groups (Automations, Guidelines): its name in the
 * bar, then one column centred on the page that scrolls. Settings' sections
 * use the same column inside the Settings dialog.
 */
export function SettingsPage({ name, children }: SettingsPageProps) {
	return (
		<Page start={<h1 className="page-bar-title">{name}</h1>}>
			<div className="page-scroll">
				<div className="settings-page">{children}</div>
			</div>
		</Page>
	);
}
