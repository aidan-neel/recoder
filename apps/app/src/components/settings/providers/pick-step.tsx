'use client';

import type { AgentProvider } from '@recoder/shared';
import { Input, ScrollArea } from '@recoder/ui';
import { Search } from 'lucide-react';
import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';

import { PickList, PickSkeleton } from './pick-list';
import { PickNotice } from './pick-notice';
import { pickGroups } from '@/lib/settings/provider-options';
import { useProviderSource } from './use-provider-source';

/** The rows a key moves between, top to bottom. */
const ROW = '[data-provider-row]';

interface PickStepProps {
	query: string;
	onQueryChange: (query: string) => void;
	onChoose: (provider: AgentProvider) => void;
}

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

/** Step one: search the agent's providers and pick one. Enter in the search box picks the first match. */
export function PickStep({ query, onQueryChange, onChoose }: PickStepProps) {
	const list = useRef<HTMLDivElement>(null);
	const search = useRef<HTMLInputElement>(null);
	const viewport = useRef<HTMLDivElement>(null);
	const source = useProviderSource();
	const groups = source.state === 'ready' ? pickGroups(source.providers, query) : [];

	useLayoutEffect(() => {
		viewport.current?.scrollTo({ top: 0 });
	}, [query]);

	if (source.state !== 'ready' && source.state !== 'loading') return <PickNotice source={source} />;

	function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
		if (moveFocus(list.current, event.key, search.current)) event.preventDefault();
	}

	function onSearchKey(event: KeyboardEvent<HTMLInputElement>): void {
		if (event.key !== 'Enter') return;

		const first = groups.flatMap((group) => group.items)[0];

		event.preventDefault();

		if (first) onChoose(first);
	}

	return (
		<div className="provider-pick" onKeyDown={onKeyDown}>
			<Input
				ref={search}
				leading={<Search aria-hidden />}
				placeholder="Search providers"
				aria-label="Search providers"
				autoComplete="off"
				spellCheck={false}
				autoFocus
				value={query}
				onChange={(event) => onQueryChange(event.target.value)}
				onKeyDown={onSearchKey}
			/>
			<ScrollArea className="provider-pick-scroll" viewportRef={viewport}>
				<div ref={list}>
					{source.state === 'ready' ? <PickList groups={groups} query={query} onChoose={onChoose} /> : <PickSkeleton />}
				</div>
			</ScrollArea>
		</div>
	);
}
