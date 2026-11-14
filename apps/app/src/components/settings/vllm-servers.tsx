'use client';

import type { VllmServer } from '@recoder/shared';
import { Button, ConfirmDialog, SkeletonRows } from '@recoder/ui';
import { Plus, RotateCw } from 'lucide-react';
import { useRef, type RefObject } from 'react';

import { useVllmSection, type VllmSection } from '@/lib/settings/use-vllm-section';

import { SettingsGroup, SettingsRow } from './settings-group';
import { SETTINGS_ROW_HEIGHT } from './settings-skeleton';
import { VllmConnectModal } from './vllm-connect';
import { VllmServerItem } from './vllm-server';

/** The skeleton row's name and detail bars, the size of a host and its sync line. */
const LOADING_WIDTHS = [['176px', '232px']] as const;

interface ServersProps {
	view: VllmSection;
	/** The Add server button on screen, which takes focus after a server is disconnected. */
	addButton: RefObject<HTMLButtonElement | null>;
}

/** Refresh and Add server, at the right of the title once a server is connected. */
function ServerActions({ view, addButton }: ServersProps) {
	return (
		<span className="server-actions">
			<Button variant="ghost" status={view.refresh.status} successLabel="Synced" onClick={view.refresh.run}>
				<RotateCw aria-hidden />
				Refresh
			</Button>
			<Button ref={addButton} variant="ghost" onClick={() => view.setAdding(true)}>
				<Plus aria-hidden />
				Add server
			</Button>
		</span>
	);
}

/** The card's rows: a skeleton until the saved servers are read, then the servers, or what to do when there are none. */
function ServerRows({ view, addButton }: ServersProps) {
	if (!view.loaded) {
		return (
			<SkeletonRows
				count={1}
				height={SETTINGS_ROW_HEIGHT}
				glyph
				widths={LOADING_WIDTHS}
				rowClassName="settings-row status-loading"
			/>
		);
	}

	if (view.servers.length === 0) {
		return (
			<SettingsRow name="No local servers" detail="Connect a vLLM server to review on the models it serves">
				<Button ref={addButton} variant="outline" onClick={() => view.setAdding(true)}>
					<Plus aria-hidden />
					Add server
				</Button>
			</SettingsRow>
		);
	}

	return view.servers.map((server) => (
		<VllmServerItem key={server.id} server={server} now={view.now} onRemove={view.askRemove} />
	));
}

/**
 * Settings → Models → Local servers: the vLLM servers Recoder reads models
 * from. Disconnecting asks first; once the server is gone its Disconnect
 * button is too, so focus moves to Add server and the keyboard keeps its place.
 */
export function VllmServers() {
	const view = useVllmSection();
	const addButton = useRef<HTMLButtonElement>(null);
	const disconnected = useRef(false);

	async function confirmRemove(server: VllmServer): Promise<void> {
		await view.confirmRemove(server);
		disconnected.current = true;
	}

	function focusAfterClose(event: Event): void {
		if (!disconnected.current) return;

		disconnected.current = false;
		event.preventDefault();
		addButton.current?.focus();
	}

	return (
		<>
			<SettingsGroup
				title="Local servers"
				action={view.servers.length > 0 ? <ServerActions view={view} addButton={addButton} /> : null}
			>
				<ServerRows view={view} addButton={addButton} />
			</SettingsGroup>
			<VllmConnectModal open={view.adding} onOpenChange={view.setAdding} />
			<ConfirmDialog
				open={view.confirmOpen}
				onOpenChange={view.setConfirmOpen}
				title={`Disconnect ${view.removing?.host ?? 'this server'}?`}
				description="Recoder forgets this address and its key. Reviews set to its models stop until you connect it again."
				confirmLabel="Disconnect"
				destructive
				onConfirm={() => (view.removing ? confirmRemove(view.removing) : undefined)}
				onCloseAutoFocus={focusAfterClose}
			/>
		</>
	);
}
