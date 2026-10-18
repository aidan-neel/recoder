'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';

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
 * The provider modal on the Agent page. Besides the page's own buttons, a
 * link to `/settings/agent?add=provider` (from an error toast or a notice)
 * opens it once the providers are loaded; closing it drops the query.
 */
export function ProviderModalHost({ request, onClose, ready }: ProviderModalHostProps) {
	const params = useSearchParams();
	const pathname = usePathname();
	const asked = params.get('add') === 'provider';
	const [handled, setHandled] = useState(false);

	if (!asked && handled) setHandled(false);

	const fromLink = ready && asked && !handled;

	function change(open: boolean): void {
		if (open) return;

		if (fromLink) {
			setHandled(true);
			window.history.replaceState(null, '', pathname);
		}

		onClose();
	}

	return (
		<ProviderModal open={request !== null || fromLink} onOpenChange={change} providerId={request?.providerId ?? null} />
	);
}
