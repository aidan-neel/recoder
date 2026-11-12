'use client';

import { useState, type ReactNode } from 'react';

import type { Forge } from '@/lib/api/connections';

import { TokenModal } from './token-modal';

/** The forge the dialog is for, whether it replaces a token the forge rejected, and which opening it is. */
interface Target {
	forge: Forge;
	replacing: boolean;
	opening: number;
}

/** Opens the token dialog for a forge; `replacing` when the forge rejected the token it has (Update token). */
export type Connect = (forge: Forge, replacing?: boolean) => void;

/**
 * The token dialog, whether it is open, and the call that opens it for a
 * forge. It keeps its forge while it closes. Each opening mounts a fresh
 * dialog, so a check or timer left from an earlier one can never reach it.
 */
export function useTokenDialog(): { connect: Connect; open: boolean; dialog: ReactNode } {
	const [target, setTarget] = useState<Target>({ forge: 'github', replacing: false, opening: 0 });
	const [open, setOpen] = useState(false);

	const connect: Connect = (forge, replacing = false) => {
		setTarget((now) => ({ forge, replacing, opening: now.opening + 1 }));
		setOpen(true);
	};

	return {
		connect,
		open,
		dialog: (
			<TokenModal
				key={target.opening}
				forge={target.forge}
				replacing={target.replacing}
				open={open}
				onOpenChange={setOpen}
			/>
		)
	};
}
