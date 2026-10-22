'use client';

import { Button, Card, DURATION, EASE_OUT, ScrollArea, SwapText } from '@recoder/ui';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useState } from 'react';

import { Brief } from '@/components/common/brief';
import { RepoBrowser } from '@/components/connections/repo-browser';
import { useTokenDialog } from '@/components/connections/use-token-dialog';
import { ProviderModal } from '@/components/settings/provider-modal';
import { recheckSetup, useSetupSteps } from '@/lib/setup/setup-gate';
import { stepsLeft } from '@/lib/setup/setup-steps';

import { ModelStep } from './model-step';
import { ProviderStep } from './provider-step';
import { RepoStep } from './repo-step';
import { useFinish } from './use-finish';

/** The count at the head of the headline; at zero it reads as done, for the beat before the queue takes over. */
const COUNT_WORDS = ['Nothing left', 'One step', 'Two steps', 'Three steps'];

/** The dialogs first run opens over the checklist. */
type Dialog = 'provider' | 'browse' | null;

/**
 * The checklist the queue shows until reviews can run: a model provider, a
 * review model and a repository. Each step checks off in place as it is
 * done; a beat after the last one, the queue takes the page.
 */
export function FirstRun() {
	const steps = useSetupSteps();
	const [dialog, setDialog] = useState<Dialog>(null);
	const token = useTokenDialog();
	const left = steps ? stepsLeft(steps) : 3;
	const leaving = useFinish(left === 0 && dialog === null && !token.open);

	if (!steps) return null;

	const current = !steps.provider ? 'provider' : !steps.model ? 'model' : !steps.repo ? 'repo' : null;

	function close(open: boolean): void {
		if (open) return;

		setDialog(null);
		recheckSetup();
	}

	return (
		<ScrollArea className="min-h-0 flex-1">
			<motion.section
				data-ui="first-run"
				className="setup"
				aria-label="First run"
				initial={false}
				animate={{ opacity: leaving ? 0 : 1 }}
				transition={{ duration: DURATION.swap, ease: EASE_OUT }}
			>
				<Brief
					as="h1"
					lead={
						<>
							<SwapText mode="wait" className="setup-count">
								{COUNT_WORDS[left]}
							</SwapText>{' '}
							before your first review.
						</>
					}
					rest="Reviews run on this machine. Your model provider sees the code under review."
				/>
				<Card className="setup-card">
					<ol className="setup-steps">
						<ProviderStep done={steps.provider} current={current === 'provider'} onAdd={() => setDialog('provider')} />
						<ModelStep done={steps.model} current={current === 'model'} />
						<RepoStep
							done={steps.repo}
							current={current === 'repo'}
							onBrowse={() => setDialog('browse')}
							onConnect={token.connect}
						/>
					</ol>
				</Card>
				<Button asChild variant="ghost" className="setup-sample">
					<Link href="/review/sample">Open the sample review</Link>
				</Button>
			</motion.section>
			<ProviderModal open={dialog === 'provider'} onOpenChange={close} />
			<RepoBrowser open={dialog === 'browse'} onOpenChange={close} />
			{token.dialog}
		</ScrollArea>
	);
}
