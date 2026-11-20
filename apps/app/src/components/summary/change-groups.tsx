'use client';

import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, DiffStat, FileChip, Pill } from '@recoder/ui';
import { CaretDownIcon, CaretRightIcon } from '@phosphor-icons/react';

import type { BugView } from '@/lib/bugs/types';
import type { GroupView } from '@/lib/summary/change-groups';

import { FindingLink } from './finding-link';
import { SummaryProse } from './prose';

interface ChangeGroupsProps {
	groups: GroupView[];
	/** Opens the Changes tab in the guide's reading order. */
	onOpenGuide: () => void;
	onOpenFile: (path: string) => void;
	onOpenFinding: (bug: BugView) => void;
}

interface GroupProps extends Pick<ChangeGroupsProps, 'onOpenFile' | 'onOpenFinding'> {
	view: GroupView;
	place: number;
}

/**
 * The change as the description groups it, in the order to read it: each group's title and what it does over its
 * files, opening to how it works and the open findings in its files. The first group stands open.
 */
export function ChangeGroups({ groups, onOpenGuide, onOpenFile, onOpenFinding }: ChangeGroupsProps) {
	return (
		<section className="summary-section" aria-labelledby="change-groups-title">
			<div className="summary-section-head">
				<h2 id="change-groups-title" className="summary-section-title">
					Changes in PR
					<span className="summary-count">{groups.length}</span>
				</h2>
				<Button variant="ghost" onClick={onOpenGuide}>
					Read in Changes
					<CaretRightIcon aria-hidden />
				</Button>
			</div>
			<ol className="change-groups">
				{groups.map((view, index) => (
					<Group
						key={view.group.id}
						view={view}
						place={index + 1}
						onOpenFile={onOpenFile}
						onOpenFinding={onOpenFinding}
					/>
				))}
			</ol>
		</section>
	);
}

/** One group: its place, title and note as the toggle, its files as chips, and its explanation and findings inside. */
function Group({ view, place, onOpenFile, onOpenFinding }: GroupProps) {
	const { group } = view;

	return (
		<Collapsible asChild defaultOpen={place === 1}>
			<li className="change-group">
				<CollapsibleTrigger className="change-group-head">
					<span className="change-group-place">{place}</span>
					<span className="change-group-text">
						<span className="change-group-title">{group.title}</span>
						<span className="change-group-note">{group.note}</span>
					</span>
					<span className="change-group-facts">
						{view.worst ? (
							<Pill tone={view.worst.tone} icon={<span aria-hidden className="pill-dot" />}>
								{view.worst.label}
							</Pill>
						) : null}
						{view.size ? <DiffStat additions={view.size.additions} deletions={view.size.deletions} /> : null}
						<CaretDownIcon aria-hidden className="change-group-caret" />
					</span>
				</CollapsibleTrigger>
				<ul className="change-group-files" aria-label={`Files in ${group.title}`}>
					{view.files.map((file) => (
						<li key={file.path}>
							<FileChip
								path={file.path}
								additions={file.additions}
								deletions={file.deletions}
								framed
								onClick={() => onOpenFile(file.path)}
							/>
						</li>
					))}
				</ul>
				<CollapsibleContent className="change-group-body">
					<div className="change-group-explanation">
						<SummaryProse>{group.explanation}</SummaryProse>
					</div>
					{view.findings.length > 0 ? (
						<ul className="finding-links" aria-label={`Findings in ${group.title}`}>
							{view.findings.map((bug) => (
								<FindingLink key={bug.id} bug={bug} onOpen={onOpenFinding} />
							))}
						</ul>
					) : null}
				</CollapsibleContent>
			</li>
		</Collapsible>
	);
}
