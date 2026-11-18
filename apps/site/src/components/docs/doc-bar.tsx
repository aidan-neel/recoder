'use client';

import {
	Button,
	CopyButton,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger
} from '@recoder/ui';
import { ArrowUpRightIcon, CaretDownIcon, CaretRightIcon } from '@phosphor-icons/react';

import type { NavPage } from '~/lib/docs';
import { openSection } from '~/lib/open-section';
import { useCurrentSection } from '~/lib/use-current-section';

interface DocBarProps {
	title: string;
	sections: NavPage['sections'];
	/** The page as Markdown, for Copy page. */
	markdown: string;
	/** Where the page's source is edited. */
	editUrl: string;
}

/**
 * The sections of the page as a menu, for narrow screens, where the sidebar
 * has no room for them: the trigger names the page and the section the
 * reader is in, and the menu marks that section.
 */
function SectionMenu({ title, sections }: Pick<DocBarProps, 'title' | 'sections'>) {
	const current = useCurrentSection(sections.map((section) => section.id));
	const currentTitle = sections.find((section) => section.id === current)?.title;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger>
				<Button variant="ghost" className="doc-bar-sections" aria-label={`Sections of ${title}`}>
					<span className="doc-bar-page">{title}</span>
					{currentTitle ? (
						<>
							<CaretRightIcon aria-hidden className="doc-bar-chevron" />
							<span className="doc-bar-current">{currentTitle}</span>
						</>
					) : null}
					<CaretDownIcon aria-hidden />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent>
				<DropdownMenuRadioGroup value={current ?? ''} onValueChange={openSection}>
					{sections.map((section) => (
						<DropdownMenuRadioItem key={section.id} value={section.id}>
							{section.title}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * The bar at the top of a docs page, which stays in view as the page
 * scrolls: where the page is (Docs › its title), Copy page, which copies the
 * page as Markdown, and Edit on GitHub. On narrow screens the crumbs give way
 * to the section menu and the actions to one copy icon.
 */
export function DocBar({ title, sections, markdown, editUrl }: DocBarProps) {
	return (
		<div className="doc-bar">
			<nav className="doc-bar-crumbs" aria-label="Breadcrumb">
				<span>Docs</span>
				<CaretRightIcon aria-hidden className="doc-bar-chevron" />
				<span className="doc-bar-current" aria-current="page">
					{title}
				</span>
			</nav>
			{sections.length > 0 ? (
				<SectionMenu title={title} sections={sections} />
			) : (
				<span className="doc-bar-sections doc-bar-current">{title}</span>
			)}
			<div className="doc-bar-actions">
				<CopyButton value={markdown} label="Copy page" className="doc-bar-wide" />
				<CopyButton value={markdown} iconOnly label="Copy page" className="doc-bar-narrow" />
				<Button asChild variant="ghost" className="doc-bar-wide">
					<a href={editUrl} target="_blank" rel="noopener noreferrer">
						Edit on GitHub
						<ArrowUpRightIcon aria-hidden />
					</a>
				</Button>
			</div>
		</div>
	);
}
