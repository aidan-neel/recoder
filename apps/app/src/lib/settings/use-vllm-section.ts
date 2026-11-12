'use client';

import type { VllmServer } from '@recoder/shared';
import type { ButtonStatus } from '@recoder/ui';
import { useEffect, useState } from 'react';

import { failureText } from '../api/http';
import { useAction } from '../shell/use-action';
import { useNow } from '../shell/use-now';
import { undoToast } from '../shell/notify';
import { useVllm } from './vllm-store';

/** How often "Synced 2 minutes ago" moves on. */
const CLOCK_MS = 15_000;

/** Forgets a server and its key. A failure rejects with the plain reason, which the confirm dialog shows. */
async function disconnect(server: VllmServer): Promise<void> {
	try {
		await useVllm.getState().disconnect(server.id);
	} catch (error) {
		throw new Error(failureText(error, `Couldn’t disconnect ${server.host}.`), { cause: error });
	}

	undoToast(`Disconnected ${server.host}`);
}

/** Everything the vLLM servers group shows and does. */
export interface VllmSection {
	servers: VllmServer[];
	/** The saved servers have been read once; before that the group shows a skeleton. */
	loaded: boolean;
	/** The time now, which moves on so "Synced 2 minutes ago" keeps up; pass it to `syncLine`. */
	now: number;
	/** The connect modal is open. */
	adding: boolean;
	setAdding: (open: boolean) => void;
	/** The server waiting on the disconnect confirm; it keeps its target while the dialog closes. */
	removing: VllmServer | null;
	confirmOpen: boolean;
	setConfirmOpen: (open: boolean) => void;
	/** Opens the disconnect confirm for a server. */
	askRemove: (server: VllmServer) => void;
	/** Forgets the server; rejects with the plain reason the dialog shows. */
	confirmRemove: (server: VllmServer) => Promise<void>;
	/** Syncs every server now. */
	refresh: { status: ButtonStatus; run: () => void };
}

/**
 * Settings → Agent → vLLM servers. Each one's models are captured from the
 * server itself, when it is connected, when Settings opens, every few
 * minutes in the background, and on Refresh, so nobody types a model by
 * hand. Disconnecting asks first.
 */
export function useVllmSection(): VllmSection {
	const servers = useVllm((state) => state.servers);
	const loaded = useVllm((state) => state.loaded);
	const [adding, setAdding] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);

	/** Outlives the dialog's close, so its copy holds while it animates out. */
	const [removing, setRemoving] = useState<VllmServer | null>(null);

	const now = useNow(CLOCK_MS);
	const refresh = useAction({ showSuccess: true });

	useEffect(() => {
		void useVllm.getState().open();
	}, []);

	function askRemove(server: VllmServer): void {
		setRemoving(server);
		setConfirmOpen(true);
	}

	return {
		servers,
		loaded,
		now,
		adding,
		setAdding,
		removing: confirmOpen ? removing : null,
		confirmOpen,
		setConfirmOpen,
		askRemove,
		confirmRemove: disconnect,
		refresh: { status: refresh.status, run: () => refresh.run(useVllm.getState().sync) }
	};
}
