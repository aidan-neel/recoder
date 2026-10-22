'use client';

import { Keycap, Modal, ModalBody, ModalContent, ModalTitle } from '@recoder/ui';
import { usePathname } from 'next/navigation';

import { paletteScope } from '@/lib/shell/routes';
import { useShell } from '@/lib/shell/shell-store';

/** One way to press a shortcut: a key, or a chord of keys held together (`['Shift', ' ']`). */
type Press = string | string[];

/** One row: the presses, any of which does it, and what it does. */
type Row = [presses: Press[], label: string];

interface Group {
	/** The page the keys work on; `anywhere` always shows last. */
	page: 'queue' | 'review' | 'anywhere';
	title: string;
	rows: Row[];
}

const GROUPS: Group[] = [
	{
		page: 'queue',
		title: 'Queue',
		rows: [
			[['j', 'k', 'ArrowDown', 'ArrowUp'], 'Next and previous pull request'],
			[['Enter'], 'Open the selected pull request'],
			[['r'], 'Review the selected pull request']
		]
	},
	{
		page: 'review',
		title: 'Review',
		rows: [
			[['j', 'k', 'ArrowDown', 'ArrowUp'], 'Next and previous item'],
			[['Enter'], 'Start with the riskiest'],
			[['a'], 'Accept: it ships as is'],
			[['s'], 'Send back to the agent'],
			[['x'], 'Not an issue: never raise it again'],
			[['u'], 'Undo the last decision'],
			[['h'], 'Hand off what you sent back'],
			[['f'], 'Open the file'],
			[['q'], 'Open or close ask'],
			[['Escape'], 'Close ask from its field'],
			[['o', 'Escape'], 'Back to the overview'],
			[[' ', 'PageDown'], 'Scroll the reading pane down'],
			[[['Shift', ' '], 'PageUp'], 'Scroll the reading pane up'],
			[['Home', 'End'], 'Top or end of the reading pane']
		]
	},
	{
		page: 'anywhere',
		title: 'Anywhere',
		rows: [
			[['mod+k'], 'Search'],
			[['mod+,'], 'Settings'],
			[['?'], 'These shortcuts']
		]
	}
];

/**
 * The groups for the page on screen: its own keys, then the ones that work
 * anywhere. Settings has no keys of its own, so it lists every group.
 */
function groupsFor(page: string): Group[] {
	const shown = GROUPS.filter((group) => group.page === page || group.page === 'anywhere');

	return shown.length > 1 ? shown : GROUPS;
}

/** One press: a key's cap, or a chord's caps side by side. */
function PressCaps({ press }: { press: Press }) {
	const keys = typeof press === 'string' ? [press] : press;

	return (
		<span className="flex gap-0.5">
			{keys.map((key) => (
				<Keycap key={key} k={key} aria-hidden={false} />
			))}
		</span>
	);
}

/** Opening on the panel itself keeps a focus ring off the close button; Tab still reaches it. */
function focusPanel(event: Event): void {
	event.preventDefault();

	if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
}

/** The keyboard shortcuts for the page on screen, then the ones that work anywhere. Opens from `?` and the palette. */
export function ShortcutsModal() {
	const open = useShell((state) => state.shortcutsOpen);
	const setOpen = useShell((state) => state.setShortcutsOpen);
	const page = paletteScope(usePathname());

	return (
		<Modal open={open} onOpenChange={setOpen}>
			<ModalContent size="md" onOpenAutoFocus={focusPanel}>
				<ModalTitle>Keyboard shortcuts</ModalTitle>
				<ModalBody data-ui="shortcuts">
					{groupsFor(page).map((group) => (
						<section key={group.title} aria-label={group.title}>
							<h3 data-ui="shortcuts-title">{group.title}</h3>
							<ul>
								{group.rows.map(([presses, label]) => (
									<li key={label} data-ui="shortcuts-row">
										<span>{label}</span>
										<span className="flex gap-1.5">
											{presses.map((press) => (
												<PressCaps key={String(press)} press={press} />
											))}
										</span>
									</li>
								))}
							</ul>
						</section>
					))}
				</ModalBody>
			</ModalContent>
		</Modal>
	);
}
