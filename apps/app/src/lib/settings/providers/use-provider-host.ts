'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { dropPageParam } from '../settings-url';

/** Where the provider modal was asked to open from the Agent section itself; null while it is closed. */
interface AddRequest {
	providerId: string | null;
}

/** Everything the provider modal host needs: whether it is open, on which provider, and how it closes. */
export interface ProviderHost {
	open: boolean;
	/** The provider to open straight on its sign-in, or null for the list. */
	providerId: string | null;
	/** The modal's onOpenChange; closing also drops a link's `add` param and clears the request. */
	onOpenChange: (open: boolean) => void;
}

/**
 * The provider modal in the Agent section. Besides the section's own buttons,
 * an address with `?add=provider` (from an error toast or a notice) opens it
 * once the providers are loaded; closing it drops `add` and leaves the page.
 */
export function useProviderHost({
	request,
	ready,
	onClose
}: {
	/** The section's own ask to open the modal; null while it is closed. */
	request: AddRequest | null;
	/** The agent's providers are loaded, so a link can open the modal. */
	ready: boolean;
	onClose: () => void;
}): ProviderHost {
	const params = useSearchParams();
	const asked = params.get('add') === 'provider';
	const [handled, setHandled] = useState(false);

	if (!asked && handled) setHandled(false);

	const fromLink = ready && asked && !handled;

	function onOpenChange(open: boolean): void {
		if (open) return;

		if (fromLink) {
			setHandled(true);
			dropPageParam('add');
		}

		onClose();
	}

	return { open: request !== null || fromLink, providerId: request?.providerId ?? null, onOpenChange };
}
