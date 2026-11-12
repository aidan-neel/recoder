'use client';

import type { AgentProvider } from '@recoder/shared';
import { HoverList, Input, Keycap, RowButton, ScrollArea, Skeleton } from '@recoder/ui';
import { Check, ChevronRight, Search } from 'lucide-react';

import { modelCount, type PickGroup } from '@/lib/settings/provider-options';
import { usePickStep } from '@/lib/settings/providers/use-pick-step';

import { PickNotice } from './provider-notice';

/** Name widths for the placeholder rows, so they do not read as copies. */
const SKELETON_WIDTHS = ['38%', '26%', '44%', '30%', '36%', '22%', '40%', '28%'];

/** What a row says at its end: that the provider is connected, or how many models it has. */
function RowMeta({ provider }: { provider: AgentProvider }) {
	if (provider.connected) {
		return (
			<span className="provider-pick-meta">
				<Check aria-hidden />
				Connected
			</span>
		);
	}

	const count = modelCount(provider);

	return count ? <span className="provider-pick-meta">{count}</span> : null;
}

interface PickRowProps {
	provider: AgentProvider;
	/** Enter in the search box picks this row, so it shows the key in place of its chevron. */
	isEnterTarget: boolean;
	onChoose: (provider: AgentProvider) => void;
}

/** One provider: its name, where it stands, and the way into its sign-in. */
function PickRow({ provider, isEnterTarget, onChoose }: PickRowProps) {
	return (
		<RowButton data-provider-row="" className="provider-pick-row" onClick={() => onChoose(provider)}>
			<span className="provider-pick-name">{provider.name}</span>
			<RowMeta provider={provider} />
			<span className="provider-pick-end">{isEnterTarget ? <Keycap k="Enter" /> : <ChevronRight aria-hidden />}</span>
		</RowButton>
	);
}

interface PickListProps {
	groups: PickGroup[];
	/** The match Enter in the search box picks while a search is typed; null with no search. */
	enterTarget: AgentProvider | null;
	emptyText: string;
	onChoose: (provider: AgentProvider) => void;
}

/** The providers under their headings, with one hover highlight that snaps from row to row. */
function PickList({ groups, enterTarget, emptyText, onChoose }: PickListProps) {
	if (groups.every((group) => group.items.length === 0)) return <p className="provider-pick-empty">{emptyText}</p>;

	return (
		<HoverList itemSelector="[data-provider-row]" className="provider-pick-list">
			{groups.map((group) => (
				<div key={group.heading ?? 'matches'} role="group" aria-label={group.heading ?? 'Matches'}>
					{group.heading ? <p className="section-label provider-pick-heading">{group.heading}</p> : null}
					{group.items.map((provider) => (
						<PickRow
							key={provider.id}
							provider={provider}
							isEnterTarget={provider === enterTarget}
							onChoose={onChoose}
						/>
					))}
				</div>
			))}
		</HoverList>
	);
}

/** The list's shape while the agent's providers load: a heading over rows of names. */
function PickSkeleton() {
	return (
		<div role="status" aria-label="Loading providers" className="provider-pick-list">
			<div className="provider-pick-heading">
				<Skeleton />
			</div>
			{SKELETON_WIDTHS.map((width) => (
				<div key={width} className="provider-pick-row">
					<Skeleton style={{ width }} />
				</div>
			))}
		</div>
	);
}

interface PickStepProps {
	query: string;
	onQueryChange: (query: string) => void;
	onChoose: (provider: AgentProvider) => void;
}

/**
 * Step one: search the agent's providers and pick one. Arrow keys walk the
 * rows like a menu, and Enter in the search box picks the first match. With
 * no list to show, the reason takes the step's place.
 */
export function PickStep({ query, onQueryChange, onChoose }: PickStepProps) {
	const { source, groups, first, emptyText, list, search, viewport, onKeyDown, onSearchKeyDown } = usePickStep({
		query,
		onChoose
	});

	if (source.state !== 'ready' && source.state !== 'loading') return <PickNotice source={source} />;

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
				onKeyDown={onSearchKeyDown}
			/>
			<ScrollArea className="provider-pick-scroll" viewportRef={viewport}>
				<div ref={list}>
					{source.state === 'ready' ? (
						<PickList
							groups={groups}
							enterTarget={query.trim() ? first : null}
							emptyText={emptyText}
							onChoose={onChoose}
						/>
					) : (
						<PickSkeleton />
					)}
				</div>
			</ScrollArea>
		</div>
	);
}
