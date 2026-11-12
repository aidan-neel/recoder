'use client';

import type { AgentProvider } from '@recoder/shared';
import type { KeyboardEvent, RefObject } from 'react';
import { useLayoutEffect, useRef } from 'react';

import { pickGroups, type PickGroup } from '../provider-options';
import { useProviderSource, type ProviderSource } from './use-provider-source';

/** The rows a key moves between, top to bottom. */
const ROW = '[data-provider-row]';

/** The rows in the list, in order. */
function rowsIn(host: HTMLElement | null): HTMLElement[] {
	return host ? [...host.querySelectorAll<HTMLElement>(ROW)] : [];
}

/**
 * Arrow keys walk the list like a menu: Down from the search box lands on
 * the first row, Up from the first row returns to the search box, Home and
 * End jump to the ends. Returns true when the key moved focus.
 */
function moveFocus(host: HTMLElement | null, key: string, search: HTMLInputElement | null): boolean {
	const rows = rowsIn(host);
	const at = rows.indexOf(document.activeElement as HTMLElement);

	if (key === 'ArrowDown') {
		rows[Math.min(at + 1, rows.length - 1)]?.focus();

		return rows.length > 0;
	}

	if (key === 'ArrowUp' && at >= 0) {
		(at === 0 ? search : rows[at - 1])?.focus();

		return true;
	}

	if ((key === 'Home' || key === 'End') && at >= 0) {
		rows[key === 'Home' ? 0 : rows.length - 1]?.focus();

		return true;
	}

	return false;
}

/** Everything the provider pick step shows and does. */
export interface PickStepView {
	/** Where the provider list stands (loading, offline, error, unready or ready). */
	source: ProviderSource;
	/** The providers under their headings for the query; empty until the source is ready. */
	groups: PickGroup[];
	/** The first match, which Enter in the search box picks. */
	first: AgentProvider | null;
	/** What the list says when it has no rows. */
	emptyText: string;
	/** Attach to the element wrapping the rows; its keys move focus between them. */
	list: RefObject<HTMLDivElement | null>;
	/** Attach to the search input; its keys are handled here. */
	search: RefObject<HTMLInputElement | null>;
	/** Attach to the scroll viewport; it scrolls back to the top when the query changes. */
	viewport: RefObject<HTMLDivElement | null>;
	/** Keydown on the step's wrapper: arrows, Home and End walk the rows. */
	onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
	/** Keydown on the search input: Enter picks the first match. */
	onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * Step one of the provider modal: the agent's providers under their headings,
 * searched by `query` (the flow owns it). The list walks like a menu — arrows,
 * Home and End move focus between the rows — and Enter in the search box picks
 * the first match.
 */
export function usePickStep({
	query,
	onChoose
}: {
	query: string;
	onChoose: (provider: AgentProvider) => void;
}): PickStepView {
	const source = useProviderSource();
	const list = useRef<HTMLDivElement>(null);
	const search = useRef<HTMLInputElement>(null);
	const viewport = useRef<HTMLDivElement>(null);

	const groups = source.state === 'ready' ? pickGroups(source.providers, query) : [];
	const first = groups.flatMap((group) => group.items)[0] ?? null;
	const term = query.trim();
	const emptyText = term ? `No providers match “${term}”.` : 'No providers to add.';

	useLayoutEffect(() => {
		viewport.current?.scrollTo({ top: 0 });
	}, [query]);

	function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
		if (moveFocus(list.current, event.key, search.current)) event.preventDefault();
	}

	function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
		if (event.key !== 'Enter') return;

		event.preventDefault();

		if (first) onChoose(first);
	}

	return { source, groups, first, emptyText, list, search, viewport, onKeyDown, onSearchKeyDown };
}
