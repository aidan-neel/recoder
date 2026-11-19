'use client';

import { useFirstRun } from '@/lib/setup/use-first-run';

import { Page } from '@/components/common/page';

import { Checklist } from './checklist';

/**
 * The rest of setup, on the pull request page once the admin is signed in. Each step checks off in place; a beat
 * after setup finishes the checklist fades and the pull request list takes the page.
 */
export function FirstRun() {
	const view = useFirstRun();

	if (!view.checklist) return null;

	return (
		<Page start={<h1 className="page-bar-title">Set up Recoder</h1>}>
			<div className="page-scroll">
				<Checklist checklist={view.checklist} leaving={view.leaving} />
			</div>
		</Page>
	);
}
