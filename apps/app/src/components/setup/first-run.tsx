'use client';

import { Card, SwapText } from '@recoder/ui';
import Link from 'next/link';

import { SAMPLE_HREF } from '@/lib/shell/routes';
import { useFirstRun } from '@/lib/setup/use-first-run';

import { Page } from '@/components/common/page';
import { RepoBrowser } from '@/components/connections/repo-browser';
import { ProviderModal } from '@/components/settings/providers/provider-modal';

import { ModelStep } from './model-step';
import { ProviderStep } from './provider-step';
import { RepoStep } from './repo-step';

/** How the headline counts the steps left, from none to all three. */
const COUNT_WORDS = ['Nothing left', 'One step', 'Two steps', 'Three steps'] as const;

/**
 * First run, on the pull request page: a model provider, a review model and
 * a repository. Each step checks off in place; a beat after the last one the
 * checklist fades and the pull request list takes the page.
 */
export function FirstRun() {
	const view = useFirstRun();
	const { steps } = view;

	if (!steps) return null;

	return (
		<Page start={<h1 className="page-bar-title">Pull requests</h1>}>
			<div className="page-scroll">
				<div
					className="page-column setup"
					data-width="reading"
					data-leaving={view.leaving || undefined}
					inert={view.leaving}
				>
					<h2 className="setup-title">
						<SwapText id={view.left} mode="wait">
							{COUNT_WORDS[view.left]} before your first review.
						</SwapText>
					</h2>
					<Card>
						<ProviderStep
							done={steps.provider}
							current={view.current === 'provider'}
							onAdd={() => view.openDialog('provider')}
						/>
						<ModelStep done={steps.model} current={view.current === 'model'} offered={steps.provider} />
						<RepoStep done={steps.repo} current={view.current === 'repo'} onBrowse={() => view.openDialog('browse')} />
					</Card>
					<div className="setup-foot">
						<p>Reviews run on this machine. Your model provider sees the code under review.</p>
						<Link href={SAMPLE_HREF} className="text-link">
							Look at a sample
						</Link>
					</div>
				</div>
			</div>
			<ProviderModal open={view.dialog === 'provider'} providerId={null} onOpenChange={view.dialogOpenChange} />
			<RepoBrowser open={view.dialog === 'browse'} onOpenChange={view.dialogOpenChange} />
		</Page>
	);
}
