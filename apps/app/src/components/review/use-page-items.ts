'use client';

import { CircleCheck, CircleDot, FileCode } from 'lucide-react';
import { useEffect } from 'react';

import { plain, where } from '@/lib/review/labels';
import { useReview, type Selection } from '@/lib/review/review-store';
import type { Surface } from '@/lib/review/surface';
import { useShell, type PaletteItem } from '@/lib/shell/shell-store';

import { useSurface } from './review-view';

function select(selection: Selection): void {
	useReview.getState().select(selection);
}

/** The review's rows for the command palette: decisions, then what was checked, then files. */
function pageItems(surface: Surface): PaletteItem[] {
	return [
		...surface.decisions.map((decision) => ({
			id: `d:${decision.id}`,
			group: 'Decisions',
			label: plain(decision.title),
			detail: where(decision.file, decision.line, null, true),
			icon: CircleDot,
			tone: decision.tone === 'question' ? 'var(--text-muted)' : `var(--sev-${decision.tone}-solid)`,
			run: () => select({ kind: 'decision', id: decision.id })
		})),
		...surface.receipts.map((receipt) => ({
			id: `r:${receipt.id}`,
			group: 'Checked for you',
			label: plain(receipt.question),
			icon: CircleCheck,
			tone: 'var(--ok)',
			run: () => select({ kind: 'receipt', id: receipt.id })
		})),
		...surface.files.map((file) => ({
			id: `f:${file.path}`,
			group: 'Files',
			label: file.path.slice(file.path.lastIndexOf('/') + 1),
			detail: file.path,
			icon: FileCode,
			run: () => select({ kind: 'file', path: file.path })
		}))
	];
}

/** Publishes the review's rows to the command palette while the page is open. */
export function usePageItems(): void {
	const surface = useSurface();

	useEffect(() => {
		useShell.getState().setPageItems(surface ? pageItems(surface) : []);
	}, [surface]);

	useEffect(() => () => useShell.getState().setPageItems([]), []);
}
