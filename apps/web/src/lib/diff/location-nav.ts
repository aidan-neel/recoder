import { getContext, setContext } from 'svelte';
import type { FileDiff } from '@recoder/shared';

/** How a finding's links reach the diff: the review's files and a way to open one at a line. */
export interface LocationNav {
	files: () => FileDiff[] | null;
	open: (file: string, line: number | null, side: 'old' | 'new') => void;
}

const KEY = Symbol('location-nav');

/** Lets findings rendered below this component open their related locations. */
export function setLocationNav(nav: LocationNav): void {
	setContext(KEY, nav);
}

/** The nearest pane's navigation, or undefined where findings are only previewed. */
export function getLocationNav(): LocationNav | undefined {
	return getContext<LocationNav | undefined>(KEY);
}
