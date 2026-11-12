'use client';

import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger
} from '@recoder/ui';
import { ChevronDown } from 'lucide-react';

import type { PullFilter } from '@/lib/pulls/types';

/** The heading each filter gives the list, and its name in the menu. */
const FILTERS: { id: PullFilter; heading: string; label: string }[] = [
	{ id: 'all', heading: 'Open pull requests', label: 'All open' },
	{ id: 'needs-review', heading: 'Needs review', label: 'Needs review' },
	{ id: 'bugs', heading: 'With bugs', label: 'With bugs' },
	{ id: 'ready', heading: 'Ready to merge', label: 'Ready to merge' }
];

interface PullFilterMenuProps {
	filter: PullFilter;
	counts: Record<PullFilter, number>;
	onChange: (filter: PullFilter) => void;
}

/** The list's heading, which is also its filter: which pull requests show, with how many each choice holds. */
export function PullFilterMenu({ filter, counts, onChange }: PullFilterMenuProps) {
	const active = FILTERS.find((entry) => entry.id === filter) ?? FILTERS[0];

	/** The menu hands back the chosen row's value as text; only a known filter is passed on. */
	function choose(value: string): void {
		const chosen = FILTERS.find((entry) => entry.id === value);

		if (chosen) onChange(chosen.id);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger>
				<Button variant="quiet" aria-label={`Showing: ${active.heading}. Change filter`}>
					{active.heading}
					<ChevronDown aria-hidden className="size-3.5 text-fg-faint" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="w-[220px]">
				<DropdownMenuRadioGroup value={filter} onValueChange={choose}>
					{FILTERS.map(({ id, label }) => (
						<DropdownMenuRadioItem key={id} value={id}>
							<span className="flex items-center justify-between gap-3">
								{label}
								<span className="tabular text-fg-faint">{counts[id]}</span>
							</span>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
