'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo } from 'react';

import { useApi } from '@/lib/api/client';
import { usePathname } from '@/lib/shell/navigation';
import { isLiveApp, routeOf, settingsHref, titleOf, type Route } from '@/lib/shell/routes';

import { AutomationsScreen } from '@/components/automations/automations-screen';
import { ChatScreen } from '@/components/chat/chat-screen';
import { PageMissing } from '@/components/common/page-missing';
import { ComposeScreen } from '@/components/compose/compose-screen';
import { GuidelinesScreen } from '@/components/guidelines/guidelines-screen';
import { PersonScreen } from '@/components/people/person-screen';
import { PullScreen } from '@/components/pull/pull-screen';
import { ReviewRedirect } from '@/components/pull/review-redirect';
import { LivePulls } from '@/components/pulls/live-pulls';
import { PullsScreen } from '@/components/pulls/pulls-screen';
import { RepoScreen } from '@/components/repo/repo-screen';
import { ReposScreen } from '@/components/repo/repos-screen';
import { SettingsScreen } from '@/components/settings/settings-screen';

const ComposeLabScreen = dynamic(() =>
	import('@/components/compose/compose-lab-screen').then((module) => module.ComposeLabScreen)
);

/** The app's name, which follows the screen's own title in the browser tab. */
const APP_NAME = 'Recoder';

/** The screen for a route. The live list waits on first run; the sample's has none. */
function Screen({ route, live }: { route: Route; live: boolean }) {
	switch (route.screen) {
		case 'pulls':
			return live ? <LivePulls /> : <PullsScreen />;
		case 'new':
			return <ComposeScreen />;
		case 'compose-lab':
			return <ComposeLabScreen variant={route.variant} />;
		case 'repos':
			return <ReposScreen />;
		case 'repo':
			return <RepoScreen repoId={route.repoId} />;
		case 'pull':
			return <PullScreen repoId={route.repoId} number={route.number} />;
		case 'chat':
			return <ChatScreen chatId={route.chatId} />;
		case 'person':
			return <PersonScreen person={route.person} />;
		case 'review':
			return <ReviewRedirect id={route.reviewId} />;
		case 'automations':
			return <AutomationsScreen />;
		case 'guidelines':
			return <GuidelinesScreen />;
		case 'settings':
			return <SettingsScreen section={route.section} view={route.view} />;
		case 'missing':
			return <PageMissing />;
	}
}

/**
 * Which page a path shows. Settings → Server's views have paths of their own, so a link opens one, but they are tabs of
 * one page: moving between them keeps it, and the view switch keeps focus.
 */
function pageOf(route: Route, pathname: string): string {
	return route.screen === 'settings' && route.view ? settingsHref(route.section) : pathname;
}

/**
 * The page beside the sidebar, picked from the address in the browser. Every
 * screen's code is already here, so a click on a link renders the next page
 * in the same frame: no request, and no wait on the old page. Another path
 * is another page, which starts from nothing; a tab or a filter of the same
 * path keeps the page it is on.
 */
export function Screens() {
	const { base } = useApi();
	const pathname = usePathname();
	const route = useMemo(() => routeOf(pathname, base), [pathname, base]);
	const title = titleOf(route);

	useEffect(() => {
		document.title = `${title} · ${APP_NAME}`;
	}, [title]);

	return <Screen key={pageOf(route, pathname)} route={route} live={isLiveApp(base)} />;
}
