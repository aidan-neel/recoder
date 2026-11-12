'use client';

import type { VllmModel } from '@recoder/shared';
import { useState } from 'react';

import { plural } from '../shell/format';

/** Models listed before the rest fold behind "Show all". */
const SHOWN = 5;

/** Everything a server's model list shows and does. */
export interface VllmModels {
	/** The first models, always shown. */
	head: VllmModel[];
	/** The rest, behind the disclosure; empty when there are no more. */
	rest: VllmModel[];
	/** The disclosure is open. */
	open: boolean;
	setOpen: (open: boolean) => void;
	/** The disclosure's label: "3 more models", or "Show fewer" while open; null when nothing folds. */
	moreLabel: string | null;
}

/**
 * One server's models: the first few always shown and the rest behind a
 * disclosure, so a server with dozens of models stays one row tall.
 */
export function useVllmModels(models: VllmModel[]): VllmModels {
	const [open, setOpen] = useState(false);
	const head = models.slice(0, SHOWN);
	const rest = models.slice(SHOWN);

	return {
		head,
		rest,
		open,
		setOpen,
		moreLabel: rest.length ? (open ? 'Show fewer' : plural(rest.length, 'more model')) : null
	};
}
