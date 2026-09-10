import type { CoverageGap, CoverageState, CoverageSummary } from '@recoder/shared';
import type { ReviewInventory } from './inventory.js';
import type { ReviewRole } from './roles.js';

export interface CoverageEntry {
	hunkId: string;
	path: string;
	role?: ReviewRole;
	state: CoverageState;
	reason: string;
}

function key(hunkId: string, role?: string): string {
	return role ? `${hunkId}::${role}` : hunkId;
}

export class CoverageLedger {
	private readonly entries = new Map<string, CoverageEntry>();

	seed(inventory: ReviewInventory): void {
		for (const file of inventory.files) {
			if (file.hunks.length === 0) continue;
			for (const hunk of file.hunks) {
				if (file.excludeReason) {
					this.mark(hunk.id, file.path, 'excluded', file.excludeReason);
				} else if (file.summarize) {
					this.mark(hunk.id, file.path, 'excluded', 'lockfile summarized rather than fully reviewed');
				} else {
					this.mark(hunk.id, file.path, 'pending', 'not yet assigned');
				}
			}
		}
	}

	assign(hunkId: string, path: string, role: ReviewRole): void {
		if (this.entries.get(key(hunkId, role))?.state === 'reviewed') return;
		this.entries.set(key(hunkId, role), {
			hunkId,
			path,
			role,
			state: 'pending',
			reason: `assigned to ${role}`
		});
		const bare = this.entries.get(hunkId);
		if (bare && bare.state === 'pending' && !bare.role) {
			this.entries.set(hunkId, { ...bare, reason: 'assigned', state: 'pending' });
		}
	}

	examined(hunkId: string, path: string, role: ReviewRole): void {
		this.entries.set(key(hunkId, role), {
			hunkId,
			path,
			role,
			state: 'reviewed',
			reason: `examined by ${role}`
		});
		this.entries.set(hunkId, { hunkId, path, state: 'reviewed', reason: `examined by ${role}` });
	}

	partial(hunkId: string, path: string, role: ReviewRole, reason: string): void {
		if (this.entries.get(key(hunkId, role))?.state === 'reviewed') return;
		this.entries.set(key(hunkId, role), { hunkId, path, role, state: 'partial', reason });
		const current = this.entries.get(hunkId);
		if (!current || current.state === 'pending') {
			this.entries.set(hunkId, { hunkId, path, state: 'partial', reason });
		}
	}

	excludeUnassigned(inventory: ReviewInventory): void {
		for (const file of inventory.files) {
			for (const hunk of file.hunks) {
				const bare = this.entries.get(hunk.id);
				if (bare && bare.state === 'pending' && bare.reason === 'not yet assigned') {
					this.entries.set(hunk.id, {
						hunkId: hunk.id,
						path: file.path,
						state: 'partial',
						reason: 'not assigned within the review budget'
					});
				}
			}
		}
	}

	private mark(hunkId: string, path: string, state: CoverageState, reason: string): void {
		this.entries.set(hunkId, { hunkId, path, state, reason });
	}

	summary(): CoverageSummary {
		const hunkStates = new Map<string, CoverageState>();
		for (const entry of this.entries.values()) {
			const current = hunkStates.get(entry.hunkId);
			const next = combine(current, entry.state);
			hunkStates.set(entry.hunkId, next);
		}
		const counts: CoverageSummary = { reviewed: 0, pending: 0, partial: 0, excluded: 0, total: hunkStates.size };
		for (const state of hunkStates.values()) counts[state]++;
		return counts;
	}

	gaps(): CoverageGap[] {
		const byHunk = new Map<string, CoverageEntry[]>();
		for (const entry of this.entries.values()) {
			const list = byHunk.get(entry.hunkId) ?? [];
			list.push(entry);
			byHunk.set(entry.hunkId, list);
		}
		const gaps: CoverageGap[] = [];
		for (const [hunkId, list] of byHunk) {
			const relevant = list.filter((entry) => entry.state !== 'reviewed');
			if (relevant.length === 0) continue;
			const worst = relevant.find((entry) => entry.state === 'pending')
				?? relevant.find((entry) => entry.state === 'partial')
				?? relevant[0];
			if (worst.state === 'excluded' && list.some((entry) => entry.state === 'reviewed')) continue;
			gaps.push({
				path: worst.path,
				hunkId,
				role: worst.role,
				state: worst.state,
				reason: worst.reason
			});
		}
		return gaps.sort((a, b) => a.path.localeCompare(b.path));
	}

	complete(): boolean {
		const summary = this.summary();
		return summary.pending === 0 && summary.partial === 0;
	}
}

function combine(current: CoverageState | undefined, next: CoverageState): CoverageState {
	if (!current) return next;
	const rank: Record<CoverageState, number> = { pending: 0, partial: 1, excluded: 2, reviewed: 3 };
	// A hunk is reviewed if any assigned responsibility reviewed it and none remain pending.
	if (current === 'pending' || next === 'pending') return 'pending';
	if (current === 'partial' || next === 'partial') return 'partial';
	return rank[next] > rank[current] ? next : current;
}
