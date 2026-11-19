'use client';

import {
	Button,
	CommandDialog,
	CommandEmpty,
	CommandFooter,
	CommandInput,
	CommandItem,
	CommandList,
	Tooltip,
	type CommandHint
} from '@recoder/ui';
import { FileTextIcon, HashIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { NavPage } from '~/lib/docs';
import { openSection } from '~/lib/open-section';

const HINTS: CommandHint[] = [
	{ keys: ['ArrowUp', 'ArrowDown'], label: 'navigate' },
	{ keys: ['Enter'], label: 'open' },
	{ keys: ['Escape'], label: 'close' }
];

/** True for ⌘K on a Mac and Ctrl+K elsewhere. */
function isSearchKey(event: KeyboardEvent): boolean {
	return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k';
}

/**
 * The site's search: the app's ghost search button at the end of the sidebar's
 * head row and ⌘K both open a palette over every page and every section of
 * the docs. Choosing a row goes there.
 */
export function SiteSearch({ pages }: { pages: NavPage[] }) {
	const [open, setOpen] = useState(false);
	const router = useRouter();

	useEffect(() => {
		function toggleOnSearchKey(event: KeyboardEvent): void {
			if (!isSearchKey(event)) return;

			event.preventDefault();
			setOpen((shown) => !shown);
		}

		window.addEventListener('keydown', toggleOnSearchKey);

		return () => window.removeEventListener('keydown', toggleOnSearchKey);
	}, []);

	/** Goes to a page or a section. A section of the open page is not a route change, so the router would not scroll to it. */
	function go(href: string): void {
		const [path, section] = href.split('#');

		setOpen(false);

		if (section && path === window.location.pathname) openSection(section);
		else router.push(href);
	}

	return (
		<>
			<Tooltip content="Search" shortcut="mod+k">
				<Button
					variant="ghost"
					size="icon"
					className="site-search"
					aria-label="Search"
					aria-keyshortcuts="Meta+K Control+K"
					onClick={() => setOpen(true)}
				>
					<MagnifyingGlassIcon />
				</Button>
			</Tooltip>
			<CommandDialog open={open} onOpenChange={setOpen} label="Search Recoder">
				<CommandInput placeholder="Search the docs" />
				<CommandList>
					<CommandEmpty>Nothing matches.</CommandEmpty>
					{pages.map((page) => (
						<PageRows key={page.href} page={page} onChoose={go} />
					))}
				</CommandList>
				<CommandFooter hints={HINTS} />
			</CommandDialog>
		</>
	);
}

/**
 * A page's row, then one row for each of its sections with the page's name at
 * its end. The rows are not in groups: cmdk ranks rows only inside a group, so
 * a group would keep a weak match above a strong one in the next group.
 */
function PageRows({ page, onChoose }: { page: NavPage; onChoose: (href: string) => void }) {
	return (
		<>
			<CommandItem value={page.title} icon={FileTextIcon} onSelect={() => onChoose(page.href)}>
				{page.title}
			</CommandItem>
			{page.sections.map((section) => (
				<CommandItem
					key={section.id}
					value={`${section.title} (${page.title})`}
					icon={HashIcon}
					detail={page.title}
					onSelect={() => onChoose(`${page.href}#${section.id}`)}
				>
					{section.title}
				</CommandItem>
			))}
		</>
	);
}
