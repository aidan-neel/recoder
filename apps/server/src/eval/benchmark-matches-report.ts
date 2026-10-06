import type { PrResult } from './benchmark-report';
import type { DefectStage, StageMatch } from './benchmark-stages';

const STAGES = ['found', 'verified', 'published'] as const;

/** One stage's credited match, keyed by how the call was made. */
type ByCounts = Record<StageMatch['by'], number>;

/** One defect's stage evidence in one run, with where it came from. */
interface Placed {
	pr: string;
	defect: string;
	run: number;
	stage: DefectStage;
}

function placed(prs: readonly PrResult[]): Placed[] {
	return prs.flatMap((pr) =>
		pr.runs.flatMap((run) =>
			pr.defects.flatMap((defect) => {
				const stage = run.stages?.[defect.id];

				return stage?.matches ? [{ pr: pr.id, defect: defect.id, run: run.index, stage }] : [];
			})
		)
	);
}

/** "found 80 judged · 4 reused": how each stage's credits were decided. */
function creditLine(all: readonly Placed[]): string {
	const parts = STAGES.map((name) => {
		const counts: ByCounts = { judged: 0, reused: 0, adjudicated: 0 };

		for (const { stage } of all) {
			const match = stage.matches![name];

			if (match.claim) counts[match.by]++;
		}

		const by = Object.entries(counts)
			.filter(([, count]) => count)
			.map(([how, count]) => `${count} ${how}`)
			.join(', ');

		return `${name} ${by || 'none'}`;
	});

	return `  credits: ${parts.join(' · ')}`;
}

/** Defects no claim at a stage reports, though the judge weighed a nearby claim there and rejected it. */
function rejectedLine(all: readonly Placed[]): string {
	const counts = STAGES.map(
		(name) =>
			`${name} ${all.filter(({ stage }) => !stage.matches![name].claim && stage.matches![name].rejected).length}`
	);

	return `  a nearby claim weighed and rejected (another behavior or cause): ${counts.join(' · ')}`;
}

/** Consolidation losses by what became of the lost claim. */
function lossLine(all: readonly Placed[]): string[] {
	const lost = all.flatMap(({ stage }) => (stage.lost ? [stage.lost.change] : []));

	if (!lost.length) return [];

	const count = (change: string) => lost.filter((item) => item === change).length;

	return [
		`  lost at consolidation: ${count('changed')} merged into a changed claim · ${count('disappeared')} disappeared · ${count('untraced')} untraced`
	];
}

/** Every stage call a human correction decided, with its reason. */
function correctionLines(all: readonly Placed[]): string[] {
	const lines = all.flatMap(({ pr, defect, run, stage }) =>
		STAGES.flatMap((name) => {
			const match = stage.matches![name];

			if (match.by !== 'adjudicated') return [];

			const call = match.claim ? `credited ${match.claim.hash}` : `rejected ${match.rejected?.hash ?? 'its match'}`;

			return [`  ${`${pr}/${defect}`.padEnd(14)} run ${run} ${name.padEnd(9)} ${call} · ${match.reason}`];
		})
	);

	return lines.length ? ['', `Human corrections (${lines.length})`, ...lines] : [];
}

/**
 * How every defect's stage calls were made: judged on that stage's claims,
 * reused from an unchanged published claim, or corrected by a human; how many
 * nearby claims the judge rejected; what became of the claims lost at
 * consolidation; and each human correction with its reason.
 */
export function matchLines(prs: readonly PrResult[]): string[] {
	const all = placed(prs);

	if (!all.length) return [];

	return ['', 'Match evidence', creditLine(all), rejectedLine(all), ...lossLine(all), ...correctionLines(all)];
}
