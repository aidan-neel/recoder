import {
	findingTier,
	type Finding,
	type Review,
	type ReviewAssignment,
	type ReviewCandidate,
	type ReviewProgress,
	type ReviewTask,
	type ReviewToolCall
} from '@recoder/shared';

import { castFiles, type SampleClaim } from './sample-cast';
import { SAMPLE_DIFFS, SMALL_DIFF } from './sample-diff';

/** The pull request whose review is already running when the sample loads. */
const EXPORTS_PULL = 216;

/** What the reviewers of the usage exports raise; the first two hold up. */
const EXPORT_CLAIMS: SampleClaim[] = [
	'Multipart upload is never aborted when a part fails',
	'Export keys collide when two tenants share a name',
	'The usage query reads past the export window',
	'A failed export is retried without a backoff',
	'The stream is buffered whole before the upload',
	'Exports of an empty month write an empty file',
	'The bucket name is read from the request',
	'Rows are written before the header line',
	'The export job holds a database connection while it uploads',
	'Timestamps are written in local time',
	'Deleted usage rows are exported',
	'The signed link outlives the export',
	'A part larger than 5 GB is sent in one request',
	'Credentials come from the environment, not the request',
	'The CSV writer does not escape quotes',
	'Two exports of one month run at once',
	'The export ignores the tenant’s time zone',
	'A cancelled export leaves its parts in the bucket',
	'The job reports success before the upload completes',
	'The usage totals are summed as floats',
	'The export file name contains the tenant’s email',
	'The upload retries on a 403',
	'Exports skip the last day of the month',
	'The progress callback fires after the job ends',
	'Large tenants time out before the first part',
	'The export reads usage from the replica with lag',
	'The S3 client is created for every part',
	'The checksum is computed over the compressed file',
	'The export endpoint has no rate limit',
	'The month parameter accepts any string',
	'The job logs the presigned URL'
].map((title, index) => ({ title, proven: index < 2 }));

/** Claims the scripted reviewers raise on the rate limiter beside its findings, all of them cleared. */
const CLEARED_CLAIMS = [
	'Limits reset when the process restarts',
	'One limiter is shared across workers',
	'The bucket size leaks in a response header',
	'A negative burst size is accepted'
];

/** The claims a scripted review raises: the exports' own on their pull request, else the findings among cleared ones. */
export function sampleClaims(review: Review, findings: Finding[]): SampleClaim[] {
	if (review.prNumber === EXPORTS_PULL) return EXPORT_CLAIMS;

	return [
		...findings.map((finding) => ({
			title: finding.title ?? finding.file,
			proven: true,
			path: finding.file,
			line: finding.line,
			tier: findingTier(finding)
		})),
		...CLEARED_CLAIMS.map((title, index) => ({ title, proven: false, drop: index === 0 ? 'location' : undefined }))
	];
}

/** The reviewers of the usage exports, each with the claims it raised. */
const PARTS: { title: string; claims: number }[] = [
	{ title: 'The export job and its upload', claims: 11 },
	{ title: 'The usage query', claims: 8 },
	{ title: 'The export endpoint', claims: 7 },
	{ title: 'Tests and configuration', claims: 5 }
];

/** How far into the check the sample loads: claims 1 and 2 at work, the rest up to this one settled. */
const LAST_SETTLED = 13;

/** When reviewer `index` finished, in seconds after the review started. */
function partEnd(index: number): number {
	return 100 + index * 6;
}

/** A task of the running review, timed in seconds after it started. */
function task(
	start: number,
	end: number,
	fields: Omit<ReviewTask, 'updatedAt' | 'startedAt'>,
	at: (s: number) => string
) {
	return { ...fields, startedAt: at(start), updatedAt: at(end) };
}

/** The verification lane claim `index` went to: the two at work hold the first two lanes. */
function laneOf(index: number): string {
	return `verifier-${index <= 2 && index > 0 ? index : (index % 3) + 1}`;
}

/** The reviewer that raised claim `index`: the parts take the claims in order, each its own count. */
function raiserOf(index: number): string {
	let left = index;

	for (const [at, part] of PARTS.entries()) {
		if (left < part.claims) return `part-${at + 1}`;

		left -= part.claims;
	}

	return 'part-1';
}

/** The verification of claim `index`: settled, at work, or queued, as the pipeline words each. */
function verification(claim: SampleClaim, index: number, at: (s: number) => string): ReviewTask {
	const fields = {
		id: `verify:${index}`,
		label: `Verify: ${claim.title}`,
		kind: 'verification' as const,
		candidateId: String(index),
		...(index <= LAST_SETTLED && { verifierId: laneOf(index) })
	};

	if (index === 1) return task(268, 296, { ...fields, status: 'running', message: 'Running code' }, at);
	if (index === 2) return task(274, 298, { ...fields, status: 'running', message: 'Reading code' }, at);
	if (index > LAST_SETTLED)
		return { ...fields, status: 'queued', message: 'Queued for verification', updatedAt: at(124) };

	const end = 140 + index * 11;
	const message = claim.proven ? 'Verified by a run' : 'Disproved; dropped';

	return task(end - 30, end, { ...fields, status: 'done', message }, at);
}

/** A done call of the running review, timed in seconds after it started. */
function doneCall(
	id: string,
	owner: string,
	command: string,
	input: ReviewToolCall['input'],
	start: number,
	at: (s: number) => string
): ReviewToolCall {
	return {
		id,
		assignmentId: owner,
		command,
		status: 'done',
		exitCode: 0,
		startedAt: at(start),
		finishedAt: at(start + 4),
		input
	};
}

/** Claim `index` as a candidate on the stream: raised by its reviewer, then where its verification stands. */
function exportCandidate(claim: SampleClaim, index: number, path: string, at: (s: number) => string): ReviewCandidate {
	const raised = { id: String(index), title: claim.title, path, line: 10 + index, raisedBy: raiserOf(index) };

	const base = {
		...raised,
		tier: claim.proven ? ('bug' as const) : ('warning' as const),
		raisedAt: at(62 + index * 2)
	};

	if (index > LAST_SETTLED) return { ...base, state: 'raised' };
	if (index === 1 || index === 2) return { ...base, state: 'verifying', verifierId: laneOf(index) };

	const end = 140 + index * 11;

	return {
		...base,
		state: claim.proven ? 'proven' : 'unproven',
		verifierId: laneOf(index),
		message: claim.proven ? 'Verified by a run' : 'Disproved; dropped',
		settledAt: at(end)
	};
}

/** The calls the review made so far: every hunk read, and each settled or working verifier's read and run. */
function exportCalls(paths: string[], assignments: ReviewAssignment[], at: (s: number) => string): ReviewToolCall[] {
	const reads = assignments.flatMap((part, index) =>
		part.scope.flatMap((scope) =>
			scope.hunkIds.map((hunk) =>
				doneCall(
					`${part.id}:${hunk}`,
					part.id,
					`readDiff ${scope.path} ${hunk}`,
					{ action: 'readDiff', path: scope.path, hunkIds: [hunk] },
					64 + index * 3,
					at
				)
			)
		)
	);

	const checks = EXPORT_CLAIMS.slice(0, LAST_SETTLED + 1).flatMap((claim, index) => {
		const path = paths[index % paths.length];
		const end = 140 + index * 11;
		const owner = `verify:${index}`;
		const read = doneCall(`${owner}:1`, owner, `read ${path}`, { action: 'readFile', path }, end - 25, at);

		if (index === 1) return [read];
		if (index === 2)
			return [{ ...read, status: 'running' as const, exitCode: null, finishedAt: undefined, startedAt: at(274) }];

		const command = `bun test -t "${claim.title}"`;

		return [read, doneCall(`${owner}:2`, owner, `$ ${command}`, { action: 'run', command, path }, end - 12, at)];
	});

	return [...reads, ...checks];
}

/**
 * The usage exports review as the sample loads it, five minutes in: the
 * change read against the repository's guidelines, four reviewers' 31
 * claims, and the check twelve claims along, one bug reproduced and two
 * verifiers at work, the newest running a test.
 */
export function exportsProgress(review: Review): ReviewProgress {
	const start = Date.parse(review.startedAt ?? review.createdAt);
	const at = (seconds: number) => new Date(start + seconds * 1000).toISOString();

	const files = castFiles(SAMPLE_DIFFS.slice(0, SMALL_DIFF));
	const paths = files.map((file) => file.path);

	const assignments: ReviewAssignment[] = PARTS.map((part, index) => ({
		id: `part-${index + 1}`,
		role: 'reviewer',
		title: part.title,
		reason: 'These files change together, so they read best side by side.',
		status: 'done',
		scope: [files[index % files.length]].map((file) => ({ path: file.path, hunkIds: file.hunks })),
		candidateCount: part.claims,
		startedAt: at(60),
		completedAt: at(partEnd(index))
	}));

	const tasks: ReviewTask[] = [
		task(
			0,
			14,
			{ id: 'fetch', label: 'Fetch', status: 'done', message: 'Checked out the head commit', kind: 'checkout' },
			at
		),
		task(
			14,
			48,
			{
				id: 'inventory',
				label: 'Understand changes',
				status: 'done',
				message: 'Inventoried 3 changed paths',
				kind: 'inventory'
			},
			at
		),
		task(
			48,
			60,
			{
				id: 'plan',
				label: 'Plan',
				status: 'done',
				message: '4 specialists, 0 tasks left unassigned',
				kind: 'planning'
			},
			at
		),
		...assignments.map((part, index) =>
			task(
				60,
				partEnd(index),
				{ id: `assignment:${part.id}`, label: part.title, status: 'done', message: 'Finished', kind: 'assignment' },
				at
			)
		),
		...EXPORT_CLAIMS.map((claim, index) => verification(claim, index, at))
	];

	const command = 'bun test tests/exports/s3.test.ts';

	return {
		id: review.id,
		sequence: 1,
		tasks: Object.fromEntries(tasks.map((item) => [item.id, item])),
		activity: [],
		toolCalls: [
			...exportCalls(paths, assignments, at),
			{
				id: 'tool-s3-test',
				assignmentId: 'verify:1',
				command: `$ ${command}`,
				status: 'running',
				exitCode: null,
				startedAt: at(290),
				input: { action: 'run', command }
			}
		],
		orchestratorModel: 'grok-4.6',
		updatedAt: at(298),
		planVersion: 1,
		assignments,
		candidates: EXPORT_CLAIMS.map((claim, index) => exportCandidate(claim, index, paths[index % paths.length], at)),
		candidateCount: EXPORT_CLAIMS.length,
		stage: 'verify',
		guidelines: {
			layers: [{ source: 'repo', path: 'RECODER.md', ref: 'main', chars: 1840, truncated: false }],
			hash: 'sample'
		}
	};
}
