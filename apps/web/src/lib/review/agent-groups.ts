import type { ReviewAssignment } from '@recoder/shared';

/**
 * Reviewers of one role, in plan order. Reading a whole large PR takes many
 * correctness parts; they read as one row that opens to its parts.
 */
export interface AgentGroup {
	role: string;
	items: ReviewAssignment[];
	/** The most telling member status: anything still working, then failures, then done. */
	status: ReviewAssignment['status'];
	finished: number;
}

const PRECEDENCE: ReviewAssignment['status'][] = ['running', 'waiting', 'queued', 'error', 'done', 'skipped'];

export function groupAgents(items: ReviewAssignment[]): AgentGroup[] {
	const groups = new Map<string, ReviewAssignment[]>();

	for (const item of items) groups.set(item.role, [...(groups.get(item.role) ?? []), item]);

	return [...groups].map(([role, members]) => ({
		role,
		items: members,
		status: PRECEDENCE.find((status) => members.some((member) => member.status === status)) ?? members[0].status,
		finished: members.filter((member) => member.status === 'done').length
	}));
}

/** "9 of 14 finished · 2 reviewing · 1 failed". */
export function groupProgress(group: AgentGroup): string {
	const count = (status: ReviewAssignment['status']) => group.items.filter((item) => item.status === status).length;

	return [
		`${group.finished} of ${group.items.length} finished`,
		count('running') ? `${count('running')} reviewing` : '',
		count('error') ? `${count('error')} failed` : '',
		count('skipped') ? `${count('skipped')} not run` : ''
	]
		.filter(Boolean)
		.join(' · ');
}
