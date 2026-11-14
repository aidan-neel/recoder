import type { ReactNode } from 'react';

import { Page } from '@/components/common/page';

interface SettingsPageProps {
	/** The page's name in the bar: "Settings", "Automations". */
	name: string;
	/** The title over the column, when the bar's name is not the page's own: a Settings section's name. */
	heading?: string;
	/** The right of the bar: a control for the whole page, such as a range. */
	end?: ReactNode;
	children: ReactNode;
}

/**
 * A page of titled setting groups (Settings, Automations, Guidelines): its
 * name in the bar, then one column centred on the page that scrolls. With a
 * heading, the heading is the page's title and the bar's name is not.
 */
export function SettingsPage({ name, heading, end, children }: SettingsPageProps) {
	const bar = heading ? <span className="page-bar-title">{name}</span> : <h1 className="page-bar-title">{name}</h1>;

	return (
		<Page start={bar} end={end}>
			<div className="page-scroll">
				<div className="settings-page">
					{heading ? <h1 className="page-title">{heading}</h1> : null}
					{children}
				</div>
			</div>
		</Page>
	);
}
