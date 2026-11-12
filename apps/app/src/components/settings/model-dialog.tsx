'use client';

import {
	CommandDialog,
	CommandEmpty,
	CommandFooter,
	CommandInput,
	CommandList,
	SkeletonRows,
	StatusNotice
} from '@recoder/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';

import { OFFLINE_TEXT } from '@/lib/api/http';
import { queryTerms, ROLE_NAME, type ModelCatalog, type ModelRole } from '@/lib/settings/model-options';
import { layoutRows, ROW_HEIGHT, scrollToCenter, scrollToReveal, stepChoice } from '@/lib/settings/model-rows';
import { retryCatalog, useSettings } from '@/lib/settings/settings-store';
import { useRootScale } from '@/lib/shell/root-scale';

import { TryAgain } from './group-notice';
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

/** Placeholder rows: enough to fill the list's full height, so the catalog swaps in without the dialog resizing. */
const PENDING_ROWS = 13;

interface SearchProps {
	role: ModelRole;
	/** Every model, grouped; null while the catalog loads. */
	catalog: ModelCatalog | null;
	current: string | null;
	onPick: (id: string) => void;
}

/**
 * The list while the catalog loads: rows of the real rows' height, which
 * stay invisible for the skeleton delay, so a quick read swaps straight to the
 * models; or why it failed, with Try again.
 */
function CatalogPending() {
	const failed = useSettings((state) => state.catalogStatus === 'offline');
	const reason = useSettings((state) => state.catalogError);

	if (failed) {
		return (
			<StatusNotice
				tone="danger"
				title="Couldn’t load the models."
				detail={reason ?? OFFLINE_TEXT}
				actions={<TryAgain retry={retryCatalog} variant="outline" />}
				className="px-2.5 py-8"
			/>
		);
	}

	return <SkeletonRows count={PENDING_ROWS} height={ROW_HEIGHT} lines={1} rowClassName="px-2.5" />;
}

/**
 * The dialog's body. It mounts with each open, so the search starts empty,
 * and lands on the current pick, scrolled to the middle, once the catalog is
 * in. A search typed while it loads is kept. cmdk keeps the selection; arrow
 * keys are handled here because only the rows near the viewport exist for
 * cmdk to walk.
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
		() => (catalog ? layoutRows(catalog.groups, terms, role === 'specialist', scale) : null),
		[catalog, terms, role, scale]
	);

	useEffect(() => {
		if (current && layout) selectRow(rowElement(field.current?.closest('[cmdk-root]'), current));
	}, [current, layout]);

	useLayoutEffect(() => {
		if (!list || !layout || landed.current) return;

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
		if (!list || !layout) return;

		const key = layout.rows[index].key;
		const top = scrollToReveal(layout, index, list.scrollTop - layout.pad, list.getBoundingClientRect().height);

		flushSync(() => setSelected(key));

		if (index === layout.rows.length - 1) scrollList(list, list.scrollHeight);
		else scrollList(list, top <= 0 ? 0 : top + layout.pad);

		selectRow(rowElement(list, key));
	}

	function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
		if (!layout || event.altKey || event.metaKey || event.ctrlKey || event.nativeEvent.isComposing) return;

		const index = stepChoice(layout, selectedKey(list), event.key);

		if (index === null) return;

		event.preventDefault();
		moveTo(index);
	}

	return (
		<>
			<div ref={field} onKeyDown={onKeyDown}>
				<CommandInput
					placeholder={catalog ? `Search ${catalog.count} models` : 'Search models'}
					value={query}
					onValueChange={(next) => {
						setQuery(next);
						if (list) scrollList(list, 0);
					}}
					trailing={ROLE_NAME[role]}
				/>
			</div>
			<CommandList className="model-list">
				{layout ? (
					<>
						<ModelRows
							layout={layout}
							list={list}
							onList={setList}
							selected={selected}
							current={current}
							onPick={onPick}
						/>
						{layout.rows.length === 0 ? <CommandEmpty>No models match “{query.trim()}”.</CommandEmpty> : null}
					</>
				) : (
					<CatalogPending />
				)}
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
