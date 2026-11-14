'use client';

import { Modal, ModalBody, ModalContent, ModalTitle } from '@recoder/ui';

import { deviceTitle } from '@/lib/account/device-copy';
import type { LinkForgeView } from '@/lib/account/use-account-menu';
import { forgeLabel } from '@/lib/connections/forges';

import { DevicePanel } from './device-panel';
import { ForgeChoices } from './forge-choices';

/**
 * Links another forge to the signed-in account with the same device sign-in
 * as the start screen. GitHub starts as the dialog opens; GitLab first asks
 * for a self-managed host, if there is one. Closing the dialog stops the sign-in.
 */
export function LinkForgeDialog({ link }: { link: LinkForgeView }) {
	const { signIn, provider } = link;
	const { state } = signIn;

	return (
		<Modal open={link.open} onOpenChange={(open) => (open ? undefined : link.close())}>
			<ModalContent size="sm" showClose={state.phase !== 'signed-in'}>
				<ModalTitle>{state.phase === 'idle' ? `Link ${forgeLabel(provider)}` : deviceTitle(state)}</ModalTitle>
				<ModalBody>
					{state.phase === 'idle' ? (
						<ForgeChoices providers={[provider]} available={new Set([provider])} start={signIn.start} />
					) : (
						<DevicePanel state={state} view={signIn} />
					)}
				</ModalBody>
			</ModalContent>
		</Modal>
	);
}
