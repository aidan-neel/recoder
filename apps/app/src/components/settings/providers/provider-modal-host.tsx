'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { dropSettingsParam } from '@/lib/settings/settings-url';

import { ProviderModal } from '../provider-modal';

/** Where the modal was asked to open from Settings itself; null while it is closed. */
export interface AddRequest {
	providerId: string | null;
}

interface ProviderModalHostProps {
	request: AddRequest | null;
	onClose: () => void;
	/** The agent's providers are loaded, so a link can open the modal. */
	ready: boolean;
}

/**
 * The provider modal in the Agent section. Besides the section's own buttons,
 * an address with `?settings=agent&add=provider` (from an error toast or a
 * notice) opens it once the providers are loaded; closing it drops `add` and
 * leaves settings open.
 */
export function ProviderModalHost({ request, onClose, ready }: ProviderModalHostProps) {
	const params = useSearchParams();
	const asked = params.get('add') === 'provider';
	const [handled, setHandled] = useState(false);

	if (!asked && handled) setHandled(false);

	const fromLink = ready && asked && !handled;

	function change(open: boolean): void {
		if (open) return;

		if (fromLink) {
			setHandled(true);
			dropSettingsParam('add');
		}

		onClose();
	}

	return (
		<ProviderModal open={request !== null || fromLink} onOpenChange={change} providerId={request?.providerId ?? null} />
	);
}
