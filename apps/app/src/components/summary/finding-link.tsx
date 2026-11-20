'use client';

import { FileChip } from '@recoder/ui';

import type { BugView } from '@/lib/bugs/types';

interface FindingLinkProps {
	bug: BugView;
	/** Opens the finding under its line on the Changes tab. */
	onOpen: (bug: BugView) => void;
}

/** One open finding as a line that opens it: its severity's mark, its title, then its severity and where it is. */
export function FindingLink({ bug, onOpen }: FindingLinkProps) {
	return (
		<li className="finding-link" data-tone={bug.kind === 'suggestion' ? 'low' : bug.tone}>
			<button type="button" className="finding-link-button" onClick={() => onOpen(bug)}>
				<span aria-hidden className="finding-link-mark" />
				<span className="finding-link-text">
					<span className="finding-link-title">{bug.title}</span>
					<span className="finding-link-meta">
						<span className="finding-link-severity">{bug.kind === 'suggestion' ? 'Suggestion' : bug.severity}</span>
						<FileChip path={bug.file} line={bug.line} />
					</span>
				</span>
			</button>
		</li>
	);
}
