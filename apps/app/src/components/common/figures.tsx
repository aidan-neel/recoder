import type { RepoFigure } from '@/lib/repo/types';

/** Five figures in a row split by hairlines: a label over the number, a quieter fact beside it. */
export function Figures({ figures }: { figures: RepoFigure[] }) {
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
