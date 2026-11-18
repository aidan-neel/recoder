'use client';

import { useSettledGate } from '@/lib/setup/use-settled-gate';

import { Page } from '@/components/common/page';
import { FirstRun } from '@/components/setup/first-run';

import { PullsScreen } from './pulls-screen';

/**
 * The pull request list on the review server: first run takes the page until
 * a provider, a model and a repository are in place. A browser that has seen
 * the list starts on it, so a load paints the list's skeleton at once. On a
 * first visit only the bar paints before the answer is known, so neither
 * screen flashes in front of the other.
 */
export function LivePulls() {
	const gate = useSettledGate();

	if (gate === 'needed') return <FirstRun />;
	if (gate === 'done') return <PullsScreen />;

	return <Page>{null}</Page>;
}
