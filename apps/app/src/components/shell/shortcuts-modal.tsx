'use client';

import { Keycap, Modal, ModalBody, ModalContent, ModalTitle } from '@recoder/ui';

import { useChrome } from '@/lib/shell/chrome';

/** One row: the keys, any of which does it, and what it does. */
type Row = [keys: string[], label: string];

interface Group {
	title: string;
	rows: Row[];
}

const GROUPS: Group[] = [
	{
		title: 'Anywhere',
		rows: [
			[['mod+k'], 'Search'],
			[['c'], 'New review'],
			[['['], 'Show or hide the sidebar'],
			[['mod+,'], 'Settings'],
			[['?'], 'These shortcuts']
		]
	},
	{
		title: 'Pull request list',
		rows: [
			[['j', 'k'], 'Next and previous pull request'],
			[['Enter'], 'Open it'],
			[['r'], 'Review it'],
			[['/'], 'Open a pull request by link']
		]
	},
	{
		title: 'Pull request',
		rows: [
			[['1', '2', '3', '4'], 'Switch tab'],
			[['j', 'k'], 'Next and previous file or bug'],
			[['v'], 'Mark the file as viewed'],
			[['r'], 'Review, or review again'],
			[['t'], 'Find a file']
		]
	},
	{
		title: 'Bug',
		rows: [
			[['Enter'], 'Open or close it'],
			[['p'], 'Post it to the pull request'],
			[['y'], 'Copy its fix prompt'],
			[['x'], 'Dismiss it']
		]
	}
];

/** Every keyboard shortcut, grouped by where it works. */
export function ShortcutsModal() {
	const open = useChrome((state) => state.shortcutsOpen);
	const setOpen = useChrome((state) => state.setShortcutsOpen);

	return (
		<Modal open={open} onOpenChange={setOpen}>
			<ModalContent size="lg">
				<ModalTitle>Keyboard shortcuts</ModalTitle>
				<ModalBody>
					<div className="shortcuts">
						{GROUPS.map((group) => (
							<section key={group.title} aria-label={group.title}>
								<h3 className="section-label">{group.title}</h3>
								{group.rows.map(([keys, label]) => (
									<div key={label} className="shortcut-row">
										{label}
										<span className="shortcut-keys">
											{keys.map((key) => (
												<Keycap key={key} k={key} aria-hidden={false} />
											))}
										</span>
									</div>
								))}
							</section>
						))}
					</div>
				</ModalBody>
			</ModalContent>
		</Modal>
	);
}
