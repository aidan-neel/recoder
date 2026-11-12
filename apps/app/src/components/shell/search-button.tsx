'use client';

import { Button, Keycap } from '@recoder/ui';
import { Search } from 'lucide-react';
import type { ReactNode } from 'react';

import type { SearchSize } from '@/lib/shell/tab-fit';

interface SearchButtonProps {
	/** Gives up 70px when the tabs need the room, and keeps only its icon in a bar too narrow for that (a phone). */
	size?: SearchSize;
	/** The ⌘K keycap. The boot frame passes its own, since it paints before React knows the platform. */
	keycap?: ReactNode;
	onClick?: () => void;
}

/** The top bar's search field: a quiet button with the ⌘K keycap. It knows nothing of the router or the palette. */
export function SearchButton({ size = 'wide', keycap = <Keycap k="mod+k" />, onClick }: SearchButtonProps) {
	return (
		<Button
			variant="quiet"
			data-slot="search-trigger"
			data-fit={size === 'wide' ? undefined : size}
			aria-label="Search"
			aria-haspopup="dialog"
			aria-keyshortcuts="Meta+K Control+K"
			onClick={onClick}
		>
			<Search aria-hidden />
			<span className="min-w-0 flex-1 truncate text-left">Search</span>
			{keycap}
		</Button>
	);
}
