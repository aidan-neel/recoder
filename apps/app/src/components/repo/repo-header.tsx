import { ForgeMark, Icon, Pill } from '@recoder/ui';

import type { RepoFacts, RepoFigure } from '@/lib/repo/types';

import { Figures } from '@/components/common/figures';

/** The repository's name under its forge's mark, over its facts as badges, auto review's among them. */
function RepoTitle({ repo }: { repo: RepoFacts }) {
	return (
		<header className="repo-head">
			<h1 className="page-title repo-title">
				<ForgeMark provider={repo.provider} className="repo-title-mark" />
				<span className="page-title-text">
					{repo.owner ? <span className="repo-title-owner">{repo.owner} / </span> : null}
					{repo.name}
				</span>
			</h1>
			<div className="repo-facts">
				<Pill face="code" icon={<Icon name="fork_right" />} title="Default branch">
					{repo.defaultBranch}
				</Pill>
				<Pill icon={<Icon name="calendar_month" />}>{repo.tracked}</Pill>
				<Pill tone={repo.autoReview ? 'ok' : 'neutral'} icon={<span aria-hidden className="pill-dot" />}>
					{repo.autoReview ? 'Auto review on' : 'Auto review off'}
				</Pill>
			</div>
		</header>
	);
}

/** The top of the page: who the repository is, then how it stands in numbers. */
export function RepoHeader({ repo, figures }: { repo: RepoFacts; figures: RepoFigure[] }) {
	return (
		<>
			<RepoTitle repo={repo} />
			<Figures figures={figures} />
		</>
	);
}
