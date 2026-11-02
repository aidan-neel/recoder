'use client';

import { HoldModal } from './hold-modal';
import { ProviderFlowView } from './providers/provider-flow';

interface ProviderModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Open straight on this provider's sign-in instead of the list (Add key on a free provider). */
	providerId?: string | null;
}

/**
 * Add a model provider to OpenCode: pick one, then sign in or paste a key.
 * Works anywhere (Settings, first run); closing it cancels a sign-in that is
 * still running. While a key or code is with the server it stays open
 * (Escape, a click outside and Cancel wait for the answer), so it has no X
 * that would look live but do nothing; Cancel closes it.
 */
export function ProviderModal({ open, onOpenChange, providerId = null }: ProviderModalProps) {
	return (
		<HoldModal open={open} onOpenChange={onOpenChange}>
			{(onSending) => (
				<ProviderFlowView providerId={providerId} close={() => onOpenChange(false)} onSending={onSending} />
			)}
		</HoldModal>
	);
}
