import { ForgeMark, Pill } from '@recoder/ui';
import { CalendarDays, GitBranch } from 'lucide-react';

import type { RepoFacts, RepoFigure } from '@/lib/repo/types';

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
				<Pill face="code" icon={<GitBranch aria-hidden />} title="Default branch">
					{repo.defaultBranch}
				</Pill>
				<Pill icon={<CalendarDays aria-hidden />}>{repo.tracked}</Pill>
				<Pill tone={repo.autoReview ? 'ok' : 'neutral'} icon={<span aria-hidden className="pill-dot" />}>
					{repo.autoReview ? 'Auto review on' : 'Auto review off'}
				</Pill>
			</div>
		</header>
	);
}

/** Five figures in a row split by hairlines: a label over the number, a quieter fact beside it. */
function Figures({ figures }: { figures: RepoFigure[] }) {
	return (
		<dl className="repo-figures">
			{figures.map((figure) => (
				<div key={figure.id} className="repo-figure">
					<dt>{figure.label}</dt>
					<dd>
						<span className="repo-figure-value">{figure.value}</span>
						{figure.detail ? (
							<span className="repo-figure-detail" data-tone={figure.tone ?? undefined}>
								{figure.detail}
							</span>
						) : null}
					</dd>
				</div>
			))}
		</dl>
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
