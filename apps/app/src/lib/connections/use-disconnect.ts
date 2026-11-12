'use client';

import type { ProviderAuth } from '@recoder/shared';
import { toast } from '@recoder/ui';
import { useState } from 'react';

import { failureText } from '../api/http';
import { useConnections } from './connections-store';
import { FORGES, type ForgeInfo } from './forges';

/**
 * Forgets the saved token. A signed-in CLI still answers for the forge, so
 * when it does the toast says so rather than the row quietly staying put. A
 * failure rejects with the plain reason, which the confirm dialog shows.
 */
async function disconnect(forge: ForgeInfo): Promise<void> {
	let after: ProviderAuth | null;

	try {
		after = await useConnections.getState().clearToken(forge.id);
	} catch (error) {
		throw new Error(failureText(error, `Couldn’t disconnect ${forge.label}.`), { cause: error });
	}

	if (after?.authenticated) {
		toast(`${forge.label} is still signed in through ${forge.cli}`, {
			description: `Sign out of the ${forge.cli} CLI to disconnect it.`
		});
	}
}

/** The disconnect confirm dialog's state and its confirm action. */
export interface ForgeDisconnect {
	/** The forge the dialog is for; it keeps its target while it closes. */
	target: ForgeInfo;
	open: boolean;
	setOpen: (open: boolean) => void;
	/** Opens the confirm for a forge. */
	ask: (forge: ForgeInfo) => void;
	/** Forgets the target's token; rejects with the plain reason the dialog shows. */
	confirm: () => Promise<void>;
}

/**
 * The "Disconnect {forge}?" confirm behind each forge row. `confirm` rejects
 * with a plain sentence when the disconnect fails, which the confirm dialog
 * shows as its failure.
 */
export function useDisconnect(): ForgeDisconnect {
	const [target, setTarget] = useState<ForgeInfo>(FORGES[0]);
	const [open, setOpen] = useState(false);

	function ask(forge: ForgeInfo): void {
		setTarget(forge);
		setOpen(true);
	}

	return { target, open, setOpen, ask, confirm: () => disconnect(target) };
}
