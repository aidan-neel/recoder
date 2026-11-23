'use client';

import type { AgentStatus } from '@recoder/shared';
import {
	Button,
	CopyButton,
	Icon,
	Modal,
	ModalBody,
	ModalClose,
	ModalContent,
	ModalFooter,
	ModalTitle,
	ScrollArea,
	StatusNotice,
	swapMotion,
	useMotionVariants
} from '@recoder/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useRef, type Ref } from 'react';

import { useAddProvider } from '@/lib/settings/providers/use-add-provider';
import { useAgentSetup, type AgentSetup as AgentSetupState } from '@/lib/settings/providers/use-agent-setup';

import { SetupJobDetail, SignInLink } from './agent-setup';
import { ProviderMark } from './provider-mark';
import { CheckAgain } from './provider-notice';

/** Shown at a row's right end once its CLI has been installed during this opening. */
function InstalledMark() {
	return (
		<span className="add-provider-installed">
			<Icon name="check" />
			Installed
		</span>
	);
}

interface RowActionsProps {
	agent: AgentStatus;
	setup: AgentSetupState;
	installRef?: Ref<HTMLButtonElement>;
}

/** Copy and Install while missing; Cancel and a pending Install while running; Installed once done. */
function RowActions({ agent, setup, installRef }: RowActionsProps) {
	const swap = useMotionVariants(swapMotion);
	const live = setup.job?.status === 'running' ? setup.job : null;
	const actionLabel = setup.error ? `Try installing ${agent.name} again` : `Install ${agent.name}`;

	return (
		<div className="add-provider-actions">
			<AnimatePresence initial={false} mode="popLayout">
				{agent.installed ? (
					<motion.span key="installed" variants={swap} initial="initial" animate="animate" exit="exit">
						<InstalledMark />
					</motion.span>
				) : (
					<motion.span
						key="controls"
						className="add-provider-controls"
						variants={swap}
						initial="initial"
						animate="animate"
						exit="exit"
					>
						{live ? (
							<Button variant="ghost" onClick={setup.cancel}>
								Cancel
							</Button>
						) : !setup.running ? (
							<CopyButton variant="ghost" iconOnly value={agent.install} label={`Copy ${agent.name} install command`} />
						) : null}
						{live?.url ? <SignInLink url={live.url} /> : null}
						<Button
							ref={installRef}
							variant="outline"
							status={setup.running ? 'pending' : 'idle'}
							aria-label={actionLabel}
							onClick={() => setup.start('install')}
						>
							{setup.error ? 'Try again' : 'Install'}
						</Button>
					</motion.span>
				)}
			</AnimatePresence>
		</div>
	);
}

/** One CLI Recoder can install, with its shell command, copy action and live output. */
function InstallableItem({ agent, installRef }: { agent: AgentStatus; installRef?: Ref<HTMLButtonElement> }) {
	const setup = useAgentSetup(agent.id);

	return (
		<li className="add-provider-item">
			<div className="add-provider-row">
				<ProviderMark agent={agent.id} />
				<div className="add-provider-text">
					<span className="add-provider-name">{agent.name}</span>
					{setup.error ? (
						<span className="add-provider-error" role="alert">
							{setup.error}
						</span>
					) : (
						<code className="add-provider-cmd" title={agent.install}>
							{agent.install}
						</code>
					)}
				</div>
				<RowActions agent={agent} setup={setup} installRef={installRef} />
			</div>
			{!agent.installed ? <SetupJobDetail setup={setup} className="add-provider-job" /> : null}
		</li>
	);
}

interface DialogPanelProps {
	firstInstallRef: Ref<HTMLButtonElement>;
	onAdded?: (key: string) => void;
}

/** Mounted fresh each time the dialog opens, so installed rows settle in place for that visit. */
function DialogPanel({ firstInstallRef, onAdded }: DialogPanelProps) {
	const view = useAddProvider(onAdded);
	const firstInstallableId = view.items.find((agent) => !agent.installed)?.id;

	return (
		<>
			<ModalTitle context="Providers">Add provider</ModalTitle>
			<ModalBody className="add-provider">
				{view.items.length === 0 ? (
					<StatusNotice
						className="add-provider-empty"
						title="Every agent CLI is installed"
						detail="Connect model providers inside OpenCode."
					/>
				) : (
					<ScrollArea className="add-provider-scroll">
						<ul className="add-provider-list" aria-label="Available providers">
							{view.items.map((agent) => (
								<InstallableItem
									key={agent.id}
									agent={agent}
									installRef={agent.id === firstInstallableId ? firstInstallRef : undefined}
								/>
							))}
						</ul>
					</ScrollArea>
				)}
			</ModalBody>
			<ModalFooter
				start={
					view.hasUninstalled ? <CheckAgain label="Check again" variant="ghost" className="add-provider-check" /> : null
				}
			>
				<ModalClose>
					<Button variant="secondary">Done</Button>
				</ModalClose>
			</ModalFooter>
		</>
	);
}

interface AddProviderDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Called with the provider key when a CLI finishes installing while the dialog is open. */
	onAdded?: (key: string) => void;
}

/**
 * Add provider: each installable agent CLI not installed yet, with its install
 * command to run here or copy to a terminal, plus Check again. Model providers
 * connect inside OpenCode's details.
 */
export function AddProviderDialog({ open, onOpenChange, onAdded }: AddProviderDialogProps) {
	const firstInstall = useRef<HTMLButtonElement>(null);

	function focusFirstInstall(event: Event): void {
		if (!firstInstall.current) return;

		event.preventDefault();
		firstInstall.current.focus();
	}

	return (
		<Modal open={open} onOpenChange={onOpenChange}>
			<ModalContent showClose={false} onOpenAutoFocus={focusFirstInstall}>
				<DialogPanel firstInstallRef={firstInstall} onAdded={onAdded} />
			</ModalContent>
		</Modal>
	);
}
