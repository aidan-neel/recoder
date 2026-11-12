'use client';

import { Button, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@recoder/ui';

import type { LearnedRuleRow, LearnedRulesView } from '@/lib/guidelines/use-learned-rules';
import { plural } from '@/lib/shell/format';

import { Age } from '@/components/common/age';

/** How often the topic's findings were dismissed, and kept when any were. */
function votesText(votes: LearnedRuleRow['votes']): string {
	const dismissed = `Dismissed ${plural(votes.dismissed, 'time')}`;

	return votes.useful > 0 ? `${dismissed}, kept ${plural(votes.useful, 'time')}` : dismissed;
}

/** Where a rule stands, in the line under its name. */
function RuleDetail({ rule }: { rule: LearnedRuleRow }) {
	if (rule.error) {
		return (
			<span className="learned-detail" data-tone="danger" role="alert">
				{rule.error}
			</span>
		);
	}

	if (rule.state === 'approved') {
		return (
			<span className="learned-detail">
				Left out <Age at={rule.decidedAt} form="long" />
			</span>
		);
	}

	if (rule.state === 'rejected') {
		return (
			<span className="learned-detail">
				Kept <Age at={rule.decidedAt} form="long" />
			</span>
		);
	}

	return <span className="learned-detail">{votesText(rule.votes)}</span>;
}

/** What a person can do with a rule: decide a proposed one, or change their mind on a decided one. */
function RuleActions({ rule }: { rule: LearnedRuleRow }) {
	const approving = rule.pending === 'approved' ? 'pending' : 'idle';
	const rejecting = rule.pending === 'rejected' ? 'pending' : 'idle';

	if (rule.state === 'approved') {
		return (
			<Button variant="ghost" status={rejecting} onClick={rule.reject}>
				Show again
			</Button>
		);
	}

	if (rule.state === 'rejected') {
		return (
			<Button variant="ghost" status={approving} onClick={rule.approve}>
				Leave out
			</Button>
		);
	}

	return (
		<>
			<Button variant="ghost" status={rejecting} onClick={rule.reject}>
				Keep showing
			</Button>
			<Button variant="outline" status={approving} onClick={rule.approve}>
				Leave out
			</Button>
		</>
	);
}

/** The trigger's words: how many rules wait for a decision, or how many there are. */
function triggerLabel(proposed: number, total: number): string {
	return proposed > 0 ? `${plural(proposed, 'rule')} to decide` : plural(total, 'learned rule');
}

interface LearnedRulesProps {
	/** The repository's rules, loaded by its row so they are there when the row first paints. */
	view: LearnedRulesView;
	repoName: string;
}

/** The way back from rules that did not load: one quiet button, with the reason on hover. */
function RetryRules({ view }: { view: LearnedRulesView }) {
	return (
		<Tooltip content={view.error}>
			<Button variant="ghost" status={view.status === 'loading' ? 'pending' : 'idle'} onClick={view.retry}>
				Retry learned rules
			</Button>
		</Tooltip>
	);
}

/**
 * What Recoder learned from dismissals in one repository, beside its row:
 * nothing while there is nothing, else a quiet trigger that opens the rules.
 * A proposed rule changes no review until a person leaves its kind of finding
 * out; a decided one can be changed back.
 */
export function LearnedRules({ view, repoName }: LearnedRulesProps) {
	if (view.error) return <RetryRules view={view} />;
	if (view.status !== 'ready' || view.rules.length === 0) return null;

	return (
		<Popover>
			<PopoverTrigger>
				<Button variant="ghost">
					{view.proposed > 0 ? <span className="learned-dot" aria-hidden /> : null}
					{triggerLabel(view.proposed, view.rules.length)}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="learned-panel">
				<h3 className="section-label">Learned in {repoName}</h3>
				<ul className="learned-list">
					{view.rules.map((rule) => (
						<li key={rule.topicId} className="learned-rule">
							<div className="learned-text">
								<span className="learned-name">{rule.label}</span>
								<RuleDetail rule={rule} />
							</div>
							<div className="learned-actions">
								<RuleActions rule={rule} />
							</div>
						</li>
					))}
				</ul>
			</PopoverContent>
		</Popover>
	);
}
