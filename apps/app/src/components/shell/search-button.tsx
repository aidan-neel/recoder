'use client';

import { Button, Keycap } from '@recoder/ui';
import { Search } from 'lucide-react';

interface SearchButtonProps {
	/** Gives up 70px when the tabs need the room. */
	compact?: boolean;
	onClick?: () => void;
}

/** The top bar's search field: a quiet button with the ⌘K keycap. It knows nothing of the router or the palette. */
export function SearchButton({ compact = false, onClick }: SearchButtonProps) {
	return (
		<Button
			variant="quiet"
			data-slot="search-trigger"
			data-compact={compact || undefined}
			aria-label="Search"
			aria-haspopup="dialog"
			aria-keyshortcuts="Meta+K Control+K"
			onClick={onClick}
		>
			<Search aria-hidden />
			<span className="min-w-0 flex-1 truncate text-left">Search</span>
			<Keycap k="mod+k" />
		</Button>
	);
}
