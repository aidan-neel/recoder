'use client';

import type { ReactNode } from 'react';

import { Page } from '@/components/common/page';

interface SettingsPageProps {
	/** The page's name in the bar: "Automations". */
	name: string;
	/** The page's own actions, at the right of the bar. */
	end?: ReactNode;
	children: ReactNode;
}

/**
 * A page of titled setting groups (Automations, Guidelines, Repositories): its name in the
 * bar, then one column centred on the page that scrolls. Settings' sections use the same column inside the Settings dialog.
 */
export function SettingsPage({ name, end, children }: SettingsPageProps) {
	return (
		<Page start={<h1 className="page-bar-title">{name}</h1>} end={end}>
			<div className="page-scroll">
				<div className="settings-page">{children}</div>
			</div>
		</Page>
	);
}
