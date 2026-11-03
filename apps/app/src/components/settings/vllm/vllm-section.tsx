'use client';

import type { VllmServer } from '@recoder/shared';
import { Button, ConfirmDialog, Skeleton } from '@recoder/ui';
import { Plus, RotateCw } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import { failureText } from '@/lib/api/http';
import { useVllm } from '@/lib/settings/vllm-store';
import { undoToast } from '@/lib/shell/notify';
import { useAction } from '@/lib/shell/use-action';
import { useNow } from '@/lib/shell/use-now';

import { Reveal } from '../providers/reveal';
import { SettingsGroup, SettingsRow } from '../settings-group';
import { VllmModal } from './vllm-modal';
import { VllmServerItem } from './vllm-server';

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

/** Syncs every server now and spins until they answer; reads "Synced" for a moment, or "Try again" when one is still down. */
function RefreshButton() {
	const sync = useAction({ showSuccess: true });

	return (
		<Button
			variant="ghost"
			status={sync.status}
			successLabel="Synced"
			onClick={() => sync.run(useVllm.getState().sync)}
		>
			<RotateCw aria-hidden />
			Refresh
		</Button>
	);
}

/** The placeholder row while the saved servers load. */
function ServersSkeleton() {
	return (
		<div className="settings-row" role="status" aria-label="Loading servers">
			<div className="flex min-w-0 flex-1 flex-col gap-2">
				<Skeleton className="h-3 w-[26%]" />
				<Skeleton className="h-2.5 w-[44%]" />
			</div>
			<Skeleton className="h-3 w-20" />
		</div>
	);
}

/**
 * Settings → Agent: the vLLM servers. Each one's models are captured from
 * the server itself, when it is connected, when Settings opens, every few
 * minutes in the background, and on Refresh, so nobody types a model by hand.
 * Disconnecting asks first, then moves focus on so the keyboard keeps its place.
 */
export function VllmSection() {
	const servers = useVllm((state) => state.servers);
	const loaded = useVllm((state) => state.loaded);
	const [adding, setAdding] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);

	/** Outlives the dialog's close, so its copy holds while it animates out. */
	const [removing, setRemoving] = useState<VllmServer | null>(null);

	const refocus = useRef(false);
	const now = useNow(CLOCK_MS);

	useEffect(() => {
		void useVllm.getState().open();
	}, []);

	useEffect(() => {
		if (confirmOpen || !refocus.current) return;

		refocus.current = false;
		document.querySelector<HTMLElement>('[data-vllm-control="add"]')?.focus();
	}, [confirmOpen]);

	const add = (
		<Button variant="ghost" data-vllm-control="add" onClick={() => setAdding(true)}>
			<Plus aria-hidden />
			Add server
		</Button>
	);

	function askRemove(server: VllmServer): void {
		setRemoving(server);
		setConfirmOpen(true);
	}

	async function confirmRemove(server: VllmServer): Promise<void> {
		await disconnect(server);
		refocus.current = servers.length === 1;
	}

	return (
		<>
			<SettingsGroup
				title="vLLM servers"
				action={
					servers.length ? (
						<span className="settings-group-actions">
							<RefreshButton />
							{add}
						</span>
					) : null
				}
			>
				{!loaded ? <ServersSkeleton /> : null}
				<AnimatePresence initial={false}>
					{servers.map((server) => (
						<Reveal key={server.id} className="provider-item">
							<VllmServerItem server={server} now={now} onRemove={askRemove} />
						</Reveal>
					))}
					{loaded && servers.length === 0 ? (
						<Reveal key="empty" className="provider-item">
							<SettingsRow
								name="No vLLM servers yet"
								description="Connect your own server to review on the models it serves"
							>
								<Button variant="outline" data-vllm-control="add" onClick={() => setAdding(true)}>
									<Plus aria-hidden />
									Add server
								</Button>
							</SettingsRow>
						</Reveal>
					) : null}
				</AnimatePresence>
			</SettingsGroup>
			<VllmModal open={adding} onOpenChange={setAdding} />
			<ConfirmDialog
				open={confirmOpen}
				onOpenChange={setConfirmOpen}
				title={`Disconnect ${removing?.host ?? 'server'}?`}
				description="Recoder forgets this address and its key. Reviews set to its models stop until you connect it again."
				confirmLabel="Disconnect"
				destructive
				onConfirm={() => (removing ? confirmRemove(removing) : undefined)}
			/>
		</>
	);
}
