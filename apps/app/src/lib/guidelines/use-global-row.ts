'use client';

import type { GuidelinesOverview } from '@recoder/shared';

import { editLayer, useGuidelinesEditor } from './editor-store';
import { firstRule, globalSummary, seedText } from './rules';
import type { GuidelinesEditorSpec } from './use-editor';

/** Everything the "Every review" row shows and does. */
export interface GlobalRowView {
	/** Its editor is open. */
	open: boolean;
	/** Counts the editor's openings; mount a fresh editor keyed by it, once it is not undefined. */
	opened: number | undefined;
	/** The row's one-line preview. */
	summary: string;
	/** The row action's label: Edit when the layer holds text, Write otherwise. */
	actionLabel: 'Edit' | 'Write';
	/** Opens the editor on the layer's text (or the starter when it is empty), asking first when another holds unsaved text. */
	edit: () => void;
	/** What the editor needs to mount; spread it into the editor component. */
	editor: GuidelinesEditorSpec;
}

/**
 * "Every review": the global layer, saved on this machine and applied to
 * every repository. Never saved, it holds Recoder's defaults, which the
 * editor opens on so they can be adjusted rather than retyped.
 */
export function useGlobalRow(overview: GuidelinesOverview): GlobalRowView {
	const open = useGuidelinesEditor((state) => state.open === 'global');
	const opened = useGuidelinesEditor((state) => state.sessions.global?.opened);
	const { global } = overview;
	const hasText = global.updatedAt === null || firstRule(global.content) !== null;

	return {
		open,
		opened,
		summary: globalSummary(global),
		actionLabel: hasText ? 'Edit' : 'Write',
		edit: () => editLayer('global', seedText(global.content, overview.template)),
		editor: { scope: 'global', open, repo: null, maxChars: overview.maxChars, label: 'Global guidelines' }
	};
}
