'use client';

import { useSettledGate } from '@/lib/setup/use-settled-gate';

import { Page } from '@/components/common/page';
import { FirstRun } from '@/components/setup/first-run';

import { PullsScreen } from './pulls-screen';

/**
 * The pull request list on the review server: first run takes the page until
 * a provider, a model and a repository are in place. Only the bar paints
 * before that is known, so neither screen flashes in front of the other.
 */
export function LivePulls() {
	const gate = useSettledGate();

	if (gate === 'needed') return <FirstRun />;
	if (gate === 'done') return <PullsScreen />;

	return <Page>{null}</Page>;
}
