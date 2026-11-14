'use client';

import type { AgentStatus } from '@recoder/shared';
import { Button, Modal, ModalBody, ModalClose, ModalContent, ModalFooter, ModalTitle } from '@recoder/ui';

import { SettingsRow } from '../settings-group';

import { AgentSetup } from './agent-setup';
import { CheckAgain } from './provider-notice';
import { ProviderMark } from './provider-mark';

interface AddProviderDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The agent CLIs not installed yet, each listed with its install command. */
	missing: readonly AgentStatus[];
}

/**
 * Add provider: each agent CLI not installed yet, with the command that sets
 * it up, then Check again so it joins the list. Model providers connect
 * inside OpenCode's details.
 */
export function AddProviderDialog({ open, onOpenChange, missing }: AddProviderDialogProps) {
	return (
		<Modal open={open} onOpenChange={onOpenChange}>
			<ModalContent size="md">
				<ModalTitle>Add provider</ModalTitle>
				<ModalBody className="add-provider">
					{missing.map((agent) => (
						<div key={agent.id} className="add-provider-cli">
							<SettingsRow
								leading={<ProviderMark agent={agent.id} />}
								name={agent.name}
								detail={agent.setup.install ? 'Install it here or in a terminal' : 'Install it in a terminal'}
							/>
							<AgentSetup agent={agent} />
						</div>
					))}
					{missing.length === 0 ? <p className="detail-text">Every agent CLI Recoder runs is installed.</p> : null}
				</ModalBody>
				<ModalFooter>
					{missing.length > 0 ? <CheckAgain label="Check again" /> : null}
					<ModalClose>
						<Button variant="ghost">Close</Button>
					</ModalClose>
				</ModalFooter>
			</ModalContent>
		</Modal>
	);
}
