'use client';

import type { KeyboardEvent, RefObject } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { queryTerms, ROLE_NAME, type ModelCatalog, type ModelRole } from './model-options';
import { layoutRows, scrollToCenter, scrollToReveal, stepChoice, type RowLayout } from './model-rows';
import { useRootScale } from '../shell/root-scale';

/** The list row whose key is `id`, as cmdk marks it. */
function rowElement(scope: Element | null | undefined, id: string): HTMLElement | null {
	return scope?.querySelector<HTMLElement>(`[cmdk-item][data-value="${CSS.escape(id)}"]`) ?? null;
}

/** cmdk selects a row under a moving pointer; a synthetic move selects one without its own scroll. */
function selectRow(row: HTMLElement | null): void {
	row?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
}

/** The key of the row cmdk has selected now. */
function selectedKey(list: HTMLElement | null): string | null {
	return list?.querySelector('[cmdk-item][aria-selected="true"]')?.getAttribute('data-value') ?? null;
}

/** Scrolls the list and tells the rows at once, so the new window mounts before the next paint. */
function scrollList(list: HTMLElement, top: number): void {
	list.scrollTop = top;
	list.dispatchEvent(new Event('scroll'));
}

/** Everything the model dialog's search needs: the query, the windowed layout, the selection and the keys that move it. */
export interface ModelDialogView {
	/** The wrapper around the search field; its keydown moves the selection. */
	field: RefObject<HTMLDivElement | null>;
	query: string;
	setQuery: (query: string) => void;
	/** The rows to lay out and window, for the role's catalog and the query's terms. */
	layout: RowLayout;
	/** The scrolling list element; pass the `[cmdk-list]` scroller to `setList` once it mounts. */
	list: HTMLElement | null;
	setList: (list: HTMLElement | null) => void;
	/** The selected row's key, which stays mounted however far the list scrolls. */
	selected: string | null;
	/** The search field's placeholder: "Search 84 models". */
	searchPlaceholder: string;
	/** The role's name, shown trailing the search field. */
	roleName: string;
	/** What the list says when the query matches nothing. */
	emptyText: string;
	/** Arrow keys move the selection (only the rows near the viewport exist for cmdk to walk). */
	onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * The model dialog's body. It mounts with each open, so the search starts
 * empty, and lands on the current pick, scrolled to the middle. cmdk keeps
 * the selection; arrow keys are handled here because only the rows near the
 * viewport exist for cmdk to walk.
 */
export function useModelDialog({
	role,
	catalog,
	current
}: {
	role: ModelRole;
	catalog: ModelCatalog;
	/** The saved pick's row key: it lands selected and scrolled to the middle. */
	current: string | null;
}): ModelDialogView {
	const [query, setQueryText] = useState('');
	const [list, setList] = useState<HTMLElement | null>(null);
	const [selected, setSelected] = useState<string | null>(current);
	const field = useRef<HTMLDivElement>(null);
	const landed = useRef(false);
	const terms = useMemo(() => queryTerms(query), [query]);
	const scale = useRootScale();

	const layout = useMemo(
		() => layoutRows(catalog.groups, terms, role === 'specialist', scale),
		[catalog, terms, role, scale]
	);

	useEffect(() => {
		if (current) selectRow(rowElement(field.current?.closest('[cmdk-root]'), current));
	}, [current]);

	useLayoutEffect(() => {
		if (!list || landed.current) return;

		const at = current ? layout.index.get(current) : undefined;

		landed.current = true;

		if (at !== undefined) scrollList(list, layout.pad + scrollToCenter(layout, at, list.clientHeight));
	}, [list, current, layout]);

	useEffect(() => {
		if (!list) return;

		const observer = new MutationObserver(() => {
			const key = selectedKey(list);

			if (key) setSelected(key);
		});

		observer.observe(list, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] });

		return () => observer.disconnect();
	}, [list]);

	/** Moves the selection to row `index`: mounts it, scrolls it into view, then hands it to cmdk. */
	function moveTo(index: number): void {
		if (!list) return;

		const key = layout.rows[index].key;
		const top = scrollToReveal(layout, index, list.scrollTop - layout.pad, list.getBoundingClientRect().height);

		flushSync(() => setSelected(key));

		if (index === layout.rows.length - 1) scrollList(list, list.scrollHeight);
		else scrollList(list, top <= 0 ? 0 : top + layout.pad);

		selectRow(rowElement(list, key));
	}

	function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
		if (event.altKey || event.metaKey || event.ctrlKey || event.nativeEvent.isComposing) return;

		const index = stepChoice(layout, selectedKey(list), event.key);

		if (index === null) return;

		event.preventDefault();
		moveTo(index);
	}

	function setQuery(query: string): void {
		setQueryText(query);
		if (list) scrollList(list, 0);
	}

	return {
		field,
		query,
		setQuery,
		layout,
		list,
		setList,
		selected,
		searchPlaceholder: `Search ${catalog.count} models`,
		roleName: ROLE_NAME[role],
		emptyText: `No models match “${query.trim()}”.`,
		onKeyDown
	};
}
