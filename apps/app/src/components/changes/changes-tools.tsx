'use client';

import { SegmentedControl } from '@recoder/ui';

import type { ViewedFilesView } from '@/lib/changes/types';

/** How the Changes tab orders the diff: the file tree's order, or the review's reading order. */
export type ChangesMode = 'files' | 'guide';

const MODES = [
	{ value: 'files', label: 'Files' },
	{ value: 'guide', label: 'Guide' }
];

interface ChangesToolsProps {
	viewed: ViewedFilesView;
	mode: ChangesMode;
	onModeChange: (mode: ChangesMode) => void;
}

/** The Changes tab's tools in the tab row: how far through the files you are, and the order to read them in. */
export function ChangesTools({ viewed, mode, onModeChange }: ChangesToolsProps) {
	return (
		<>
			{viewed.total > 0 ? (
				<span className="meta tabular">
					{viewed.count} of {viewed.total} viewed
				</span>
			) : null}
			<SegmentedControl
				size="sm"
				aria-label="Order of the diff"
				value={mode}
				onValueChange={(value) => onModeChange(value === 'guide' ? 'guide' : 'files')}
				options={MODES}
			/>
		</>
	);
}
