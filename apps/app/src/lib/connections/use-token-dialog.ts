'use client';

import { useState } from 'react';

import type { Forge } from '../api/connections';

/** The token dialog's state: which forge it is for, whether it is open, and which opening it is. */
export interface TokenDialog {
	/** Opens the dialog for a forge. Each opening is fresh, so key the dialog by `opening`. */
	connect: (forge: Forge) => void;
	open: boolean;
	setOpen: (open: boolean) => void;
	/** The forge the dialog is for; it keeps its forge while it closes. */
	forge: Forge;
	/** Counts the openings, so a check or timer left from an earlier one can never reach the next. */
	opening: number;
	/** Runs once a token was saved and the dialog is closing. */
	onSaved: (() => void) | undefined;
}

/**
 * The token dialog, whether it is open, and the call that opens it for a
 * forge. It keeps its forge while it closes. Each opening is a new `opening`,
 * so the markup can mount a fresh dialog and nothing from an earlier one
 * reaches it.
 */
export function useTokenDialog(onSaved?: () => void): TokenDialog {
	const [target, setTarget] = useState<{ forge: Forge; opening: number }>({ forge: 'github', opening: 0 });
	const [open, setOpen] = useState(false);

	function connect(forge: Forge): void {
		setTarget((now) => ({ forge, opening: now.opening + 1 }));
		setOpen(true);
	}

	return { connect, open, setOpen, forge: target.forge, opening: target.opening, onSaved };
}
