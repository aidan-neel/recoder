'use client';

import { Button } from '@recoder/ui';
import type { ReactNode } from 'react';

import type { GuidelinesEditorSpec } from '@/lib/guidelines/use-editor';

import { GuidelinesEditor } from './guidelines-editor';
import { GuidelinesRow } from './guidelines-row';

/** What a layer that can be edited shows: the parts the global row and a repository's row share. */
interface LayerView {
	summary: string;
	open: boolean;
	/** Counts the editor's openings; each one mounts a fresh editor. Undefined until the first. */
	opened: number | undefined;
	actionLabel: string;
	edit: () => void;
	editor: GuidelinesEditorSpec;
}

interface LayerRowProps {
	name: string;
	/** Pills before the button, for a repository's file. */
	status?: ReactNode;
	view: LayerView;
}

/** A layer that can be edited: its row with Edit or Write, and the editor that unfolds under it. */
export function LayerRow({ name, status, view }: LayerRowProps) {
	return (
		<GuidelinesRow
			name={name}
			summary={view.summary}
			status={status}
			open={view.open}
			action={
				<Button variant="outline" onClick={view.edit}>
					{view.actionLabel}
				</Button>
			}
		>
			{view.opened === undefined ? null : <GuidelinesEditor key={view.opened} {...view.editor} />}
		</GuidelinesRow>
	);
}
