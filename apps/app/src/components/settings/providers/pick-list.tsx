'use client';

import type { AgentProvider } from '@recoder/shared';
import { HoverList, RowButton, Skeleton } from '@recoder/ui';
import { Check, ChevronRight } from 'lucide-react';

import { modelCount, type PickGroup } from '@/lib/settings/provider-options';

/** Name widths for the placeholder rows, so they don't read as copies. */
const SKELETON_WIDTHS = ['w-[38%]', 'w-[26%]', 'w-[44%]', 'w-[30%]', 'w-[36%]', 'w-[22%]', 'w-[40%]', 'w-[28%]'];

/** One provider: its name, whether it is connected or how many models it has, and a chevron into its sign-in. */
function PickRow({ provider, onChoose }: { provider: AgentProvider; onChoose: (provider: AgentProvider) => void }) {
	const count = modelCount(provider);

	return (
		<RowButton data-provider-row="" className="provider-pick-row" onClick={() => onChoose(provider)}>
			<span className="min-w-0 flex-1 truncate">{provider.name}</span>
			{provider.connected ? (
				<span className="provider-pick-meta text-ok">
					<Check aria-hidden className="size-3.5" strokeWidth={2.25} />
					Connected
				</span>
			) : count ? (
				<span className="provider-pick-meta text-fg-faint">{count}</span>
			) : null}
			<ChevronRight aria-hidden className="size-3.5 shrink-0 text-fg-faint" />
		</RowButton>
	);
}

interface PickListProps {
	groups: PickGroup[];
	query: string;
	onChoose: (provider: AgentProvider) => void;
}

/** The providers under their headings, with one hover highlight that snaps from row to row. */
export function PickList({ groups, query, onChoose }: PickListProps) {
	if (groups.every((group) => group.items.length === 0)) {
		const text = query.trim() ? `No providers match “${query.trim()}”.` : 'No providers to add.';

		return <p className="provider-pick-empty">{text}</p>;
	}

	return (
		<HoverList itemSelector="[data-provider-row]" className="provider-pick-list">
			{groups.map((group) => (
				<div key={group.heading ?? 'matches'} role="group" aria-label={group.heading ?? 'Matches'}>
					{group.heading ? <p className="provider-pick-heading">{group.heading}</p> : null}
					{group.items.map((provider) => (
						<PickRow key={provider.id} provider={provider} onChoose={onChoose} />
					))}
				</div>
			))}
		</HoverList>
	);
}

/** The list's shape while the agent's providers load: a heading over rows of names. */
export function PickSkeleton() {
	return (
		<div role="status" aria-label="Loading providers" className="provider-pick-list">
			<div className="provider-pick-heading">
				<Skeleton className="h-2.5 w-14" />
			</div>
			{SKELETON_WIDTHS.map((width) => (
				<div key={width} className="provider-pick-row flex">
					<Skeleton className={`h-3 ${width}`} />
				</div>
			))}
		</div>
	);
}
