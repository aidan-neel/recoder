'use client';

import { Button, Card, DURATION, EASE_OUT, ScrollArea, SwapText } from '@recoder/ui';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Brief } from '@/components/common/brief';
import { PageNotice } from '@/components/common/page-notice';
import { RepoBrowser } from '@/components/connections/repo-browser';
import { useTokenDialog } from '@/components/connections/use-token-dialog';
import { ProviderModal } from '@/components/settings/provider-modal';
import { OFFLINE_TEXT } from '@/lib/api/http';
import { useConnections } from '@/lib/connections/connections-store';
import { pending, useSettings } from '@/lib/settings/settings-store';
import { recheckSetup, useSetupSteps } from '@/lib/setup/setup-gate';
import { stepsLeft } from '@/lib/setup/setup-steps';
import { useAction } from '@/lib/shell/use-action';

import { ModelStep } from './model-step';
import { ProviderStep } from './provider-step';
import { RepoStep } from './repo-step';
import { SetupSkeleton } from './setup-skeleton';
import { useFinish } from './use-finish';

/** The count at the head of the headline; at zero it reads as done, for the beat before the queue takes over. */
const COUNT_WORDS = ['Nothing left', 'One step', 'Two steps', 'Three steps'];

/** The dialogs first run opens over the checklist. */
type Dialog = 'provider' | 'browse' | null;

/** Where first run's own data stands, or what failed: the settings, the repositories and the forge check. */
type SetupData = { state: 'loading' | 'ready' } | { state: 'failed'; text: string };

/**
 * Loads what the steps show (the agents and providers, the model catalog the
 * model step picks from, the repositories and the forges) and checks again
 * whenever the window regains focus, since a provider or a token is often set
 * up in another window.
 */
function useSetupData(): SetupData {
	const models = useSettings((state) => state.catalogStatus);
	const agents = useSettings((state) => state.agentsStatus);
	const settingsError = useSettings((state) => state.catalogError);
	const repos = useConnections((state) => state.repos !== null);
	const reposStatus = useConnections((state) => state.reposStatus);
	const reposError = useConnections((state) => state.reposError);
	const auth = useConnections((state) => state.authStatus);

	useEffect(() => {
		void useSettings.getState().load();
		void useConnections.getState().loadRepos();
		void useConnections.getState().loadAuth();
		window.addEventListener('focus', recheckSetup);

		return () => window.removeEventListener('focus', recheckSetup);
	}, []);

	if (models === 'offline') return { state: 'failed', text: settingsError ?? OFFLINE_TEXT };

	if (!repos && (reposStatus === 'offline' || reposStatus === 'error')) {
		return { state: 'failed', text: reposError ?? OFFLINE_TEXT };
	}

	return { state: models !== 'ready' || pending(agents) || !repos || pending(auth) ? 'loading' : 'ready' };
}

/** Loads first run's data again; rejects while it still fails, so the button shows that. */
async function reloadSetup(): Promise<void> {
	await recheckSetup();

	const { catalogStatus } = useSettings.getState();
	const { repos } = useConnections.getState();

	if (catalogStatus !== 'ready' || !repos) throw new Error('Setup didn’t load.');
}

/** First run when its data did not load: what failed, a way to try again, and the sample review. */
function SetupFailed({ text }: { text: string }) {
	const retry = useAction();

	return (
		<ScrollArea className="min-h-0 flex-1">
			<PageNotice lead="Couldn’t load your setup." rest={text}>
				<Button status={retry.status} onClick={() => retry.run(reloadSetup)}>
					Try again
				</Button>
				<Button asChild variant="outline">
					<Link href="/review/sample">Open the sample review</Link>
				</Button>
			</PageNotice>
		</ScrollArea>
	);
}

/**
 * The checklist the queue shows until reviews can run: a model provider, a
 * review model and a repository. It paints whole once its data has loaded,
 * over a skeleton of the same size until then. Each step checks off in place
 * as it is done; a beat after the last one, the queue takes the page.
 */
export function FirstRun() {
	const steps = useSetupSteps();
	const data = useSetupData();
	const [dialog, setDialog] = useState<Dialog>(null);
	const token = useTokenDialog();
	const left = steps ? stepsLeft(steps) : 3;
	const leaving = useFinish(data.state === 'ready' && left === 0 && dialog === null && !token.open);

	if (data.state === 'failed') return <SetupFailed text={data.text} />;
	if (data.state === 'loading' || !steps) return <SetupSkeleton steps={steps} />;

	const current = !steps.provider ? 'provider' : !steps.model ? 'model' : !steps.repo ? 'repo' : null;

	function close(open: boolean): void {
		if (open) return;

		setDialog(null);
		void recheckSetup();
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
