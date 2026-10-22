'use client';

import { CommandDialog, CommandEmpty, CommandFooter, CommandInput, CommandList } from '@recoder/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';

import { queryTerms, ROLE_NAME, type ModelCatalog, type ModelRole } from '@/lib/settings/model-options';
import { layoutRows, scrollToCenter, scrollToReveal, stepChoice } from '@/lib/settings/model-rows';
import { useRootScale } from '@/lib/shell/root-scale';

import { ModelRows } from './model-rows';

const HINTS = [
	{ keys: ['ArrowUp', 'ArrowDown'], label: 'navigate' },
	{ keys: ['Enter'], label: 'choose' },
	{ keys: ['Escape'], label: 'close' }
];

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

interface SearchProps {
	role: ModelRole;
	catalog: ModelCatalog;
	current: string | null;
	onPick: (id: string) => void;
}

/**
 * The dialog's body. It mounts with each open, so the search starts empty,
 * and lands on the current pick, scrolled to the middle. cmdk keeps the
 * selection; arrow keys are handled here because only the rows near the
 * viewport exist for cmdk to walk.
 */
function ModelSearch({ role, catalog, current, onPick }: SearchProps) {
	const [query, setQuery] = useState('');
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

	function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
		if (event.altKey || event.metaKey || event.ctrlKey || event.nativeEvent.isComposing) return;

		const index = stepChoice(layout, selectedKey(list), event.key);

		if (index === null) return;

		event.preventDefault();
		moveTo(index);
	}

	return (
		<>
			<div ref={field} onKeyDown={onKeyDown}>
				<CommandInput
					placeholder={`Search ${catalog.count} models`}
					value={query}
					onValueChange={(next) => {
						setQuery(next);
						if (list) scrollList(list, 0);
					}}
					trailing={ROLE_NAME[role]}
				/>
			</div>
			<CommandList className="model-list">
				<ModelRows layout={layout} list={list} onList={setList} selected={selected} current={current} onPick={onPick} />
				{layout.rows.length === 0 ? <CommandEmpty>No models match “{query.trim()}”.</CommandEmpty> : null}
			</CommandList>
			<CommandFooter hints={HINTS} />
		</>
	);
}

interface ModelDialogProps extends SearchProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/** The model palette: every model grouped by provider, searchable by any word of its name, provider or id. */
export function ModelDialog({ open, onOpenChange, ...search }: ModelDialogProps) {
	return (
		<CommandDialog
			open={open}
			onOpenChange={onOpenChange}
			label={ROLE_NAME[search.role]}
			shouldFilter={false}
			className="model-dialog max-w-[560px]"
		>
			<ModelSearch {...search} />
		</CommandDialog>
	);
}
