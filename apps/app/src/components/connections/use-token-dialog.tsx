'use client';

import { useState, type ReactNode } from 'react';

import type { Forge } from '@/lib/api/connections';

import { TokenModal } from './token-modal';

/** The forge the dialog is for, and which opening it is. */
interface Target {
	forge: Forge;
	opening: number;
}

/**
 * The token dialog, whether it is open, and the call that opens it for a
 * forge. It keeps its forge while it closes. Each opening mounts a fresh
 * dialog, so a check or timer left from an earlier one can never reach it.
 */
export function useTokenDialog(): { connect: (forge: Forge) => void; open: boolean; dialog: ReactNode } {
	const [target, setTarget] = useState<Target>({ forge: 'github', opening: 0 });
	const [open, setOpen] = useState(false);

	function connect(forge: Forge): void {
		setTarget((now) => ({ forge, opening: now.opening + 1 }));
		setOpen(true);
	}

	return {
		connect,
		open,
		dialog: <TokenModal key={target.opening} forge={target.forge} open={open} onOpenChange={setOpen} />
	};
}
