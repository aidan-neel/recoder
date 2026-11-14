import type { UpdateCommit } from '@recoder/shared';

/** What an update brings in, one change a line. */
export function UpdateCommits({ commits }: { commits: UpdateCommit[] }) {
	return (
		<ul className="update-commits" aria-label="What’s new">
			{commits.map((commit) => (
				<li key={commit.sha} className="update-commit">
					{commit.subject}
				</li>
			))}
		</ul>
	);
}
