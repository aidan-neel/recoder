import type {
	FileDiff,
	FindingTier,
	ReviewAssignment,
	ReviewCandidate,
	ReviewProgress,
	ReviewTask,
	ReviewToolCall
} from '@recoder/shared';

/**
 * The scripted run's cast, step by step: reviewers reading their files hunk by
 * hunk and raising candidates, a subagent answering one reviewer's question,
 * and verifiers taking the candidates in lanes. Each step changes the progress
 * the way the server's events would, so Studio plays it as it plays a real run.
 */

/** A changed file and its hunks, as the plan hands them out. */
export interface CastFile {
	path: string;
	hunks: string[];
}

/** The diff's files as the plan deals them: each hunk by its place in the file, and a file with none as one. */
export function castFiles(diffs: FileDiff[]): CastFile[] {
	return diffs.map((diff) => ({
		path: diff.path,
		hunks: Array.from({ length: Math.max(1, diff.hunks.length) }, (_, index) => `h${index + 1}`)
	}));
}

/** A claim the scripted reviewers raise, where, and what becomes of it. */
export interface SampleClaim {
	title: string;
	proven: boolean;
	path?: string;
	line?: number;
	tier?: FindingTier;
	/** The validation stage that drops it before any verifier sees it. */
	drop?: string;
}

interface CastRun {
	progress: ReviewProgress;
	files: CastFile[];
	claims: SampleClaim[];
}

const TITLES = ['The core change', 'Where it is wired in', 'Tests and docs', 'Shared helpers'];

/** How many verifiers check at once. */
const LANES = 3;

export function now(): string {
	return new Date().toISOString();
}

/** Sets a task as the server does: it keeps the time it first ran. */
export function setTask(run: CastRun, task: Omit<ReviewTask, 'updatedAt'>): void {
	const previous = run.progress.tasks[task.id];
	const startedAt = previous?.startedAt ?? (task.status === 'running' ? now() : undefined);

	run.progress.tasks = { ...run.progress.tasks, [task.id]: { ...task, startedAt, updatedAt: now() } };
}

/** A large change reads best with each reviewer on a run of neighbouring files, up to this many reviewers. */
const MOST_REVIEWERS = 12;

function lastFolder(path: string): string {
	const folder = folderOf(path);

	return folder.slice(folder.lastIndexOf('/') + 1);
}

/**
 * The reviewers' plan. A small change goes to up to four parts, its files dealt in turn; a large one to up to twelve,
 * each a run of neighbouring files named for its folders.
 */
export function castPlan(files: CastFile[]): ReviewAssignment[] {
	const small = files.length <= 16;

	const count = small
		? Math.min(TITLES.length, Math.max(1, Math.ceil(files.length / 2)))
		: Math.min(MOST_REVIEWERS, Math.ceil(files.length / 25));

	const size = Math.ceil(files.length / count);

	return Array.from({ length: count }, (_, index) => {
		const own = small ? files.filter((_, at) => at % count === index) : files.slice(index * size, (index + 1) * size);
		const first = lastFolder(own[0]?.path ?? '');
		const last = lastFolder(own.at(-1)?.path ?? '');

		return {
			id: `part-${index + 1}`,
			role: 'reviewer',
			title: small ? TITLES[index] : first === last ? first : `${first} to ${last}`,
			reason: 'These files change together, so they read best side by side.',
			status: 'running',
			scope: own.map((file) => ({ path: file.path, hunkIds: file.hunks }))
		};
	});
}

/** Who raises each claim and where: on its own file when a reviewer has it, else on a file dealt round. */
function claimPlan(run: CastRun): { reviewer: string; path: string; line: number }[] {
	const parts = (run.progress.assignments ?? []).filter((part) => !part.askedBy);

	return run.claims.map((claim, index) => {
		const owner = parts.find((part) => part.scope.some((scope) => scope.path === claim.path));
		const part = owner ?? parts[index % parts.length];
		const scope = part.scope[index % part.scope.length];

		return {
			reviewer: part.id,
			path: owner ? (claim.path ?? scope.path) : scope.path,
			line: claim.line ?? 12 + index * 7
		};
	});
}

function callsOf(run: CastRun, owner: string): ReviewToolCall[] {
	return (run.progress.toolCalls ?? []).filter((call) => call.assignmentId === owner);
}

function putCall(run: CastRun, call: ReviewToolCall): void {
	const calls = (run.progress.toolCalls ?? []).filter((item) => item.id !== call.id);

	run.progress.toolCalls = [...calls, call].slice(-300);
}

function startCall(run: CastRun, owner: string, command: string, input: ReviewToolCall['input']): void {
	const id = `${owner}:${callsOf(run, owner).length + 1}`;

	putCall(run, { id, assignmentId: owner, command, status: 'running', exitCode: null, startedAt: now(), input });
}

/** Finishes the owner's running call, if it has one; true when it did. */
function finishCall(run: CastRun, owner: string, summary: string): boolean {
	const running = callsOf(run, owner).findLast((call) => call.status === 'running');

	if (!running) return false;

	putCall(run, { ...running, status: 'done', exitCode: 0, finishedAt: now(), summary });

	return true;
}

function putCandidate(run: CastRun, candidate: ReviewCandidate): void {
	const list = (run.progress.candidates ?? []).filter((item) => item.id !== candidate.id);
	const at = (run.progress.candidates ?? []).findIndex((item) => item.id === candidate.id);

	list.splice(at === -1 ? list.length : at, 0, candidate);
	run.progress.candidates = list;
}

function candidate(run: CastRun, id: string): ReviewCandidate | undefined {
	return run.progress.candidates?.find((item) => item.id === id);
}

function setPart(run: CastRun, id: string, change: Partial<ReviewAssignment>): void {
	run.progress.assignments = (run.progress.assignments ?? []).map((part) =>
		part.id === id ? { ...part, ...change } : part
	);
}

function folderOf(path: string): string {
	return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';
}

/** Raises the claims planned for this reviewer on the file it just opened. */
function raiseClaims(run: CastRun, reviewer: string, path: string): void {
	for (const [index, plan] of claimPlan(run).entries()) {
		const id = `c${index + 1}`;

		if (plan.reviewer !== reviewer || plan.path !== path || candidate(run, id)) continue;

		putCandidate(run, {
			id,
			title: run.claims[index].title,
			path,
			line: plan.line,
			tier: run.claims[index].tier ?? (run.claims[index].proven ? 'bug' : 'warning'),
			raisedBy: reviewer,
			raisedAt: now(),
			state: 'raised'
		});
	}
}

/** One beat of a reviewer: it finishes its call and opens the next hunk, or searches, or is done. */
function stepReviewer(run: CastRun, part: ReviewAssignment): void {
	finishCall(run, part.id, '1 hunk');

	const queue = part.scope.flatMap((scope) => scope.hunkIds.map((hunk) => ({ path: scope.path, hunk })));
	const calls = callsOf(run, part.id);
	const reads = calls.filter((call) => call.input?.action === 'readDiff').length;
	const next = queue[reads];

	if (!next) {
		const raised = (run.progress.candidates ?? []).filter((item) => item.raisedBy === part.id).length;

		setPart(run, part.id, { status: 'done', candidateCount: raised, completedAt: now(), currentOperation: 'Finished' });

		return;
	}

	if (calls.length % 4 === 3) {
		const word = next.path.slice(next.path.lastIndexOf('/') + 1).replace(/\..*$/, '');

		startCall(run, part.id, `rg -n "${word}" ${folderOf(next.path)}`, {
			action: 'search',
			query: word,
			prefix: folderOf(next.path),
			path: next.path
		});

		return;
	}

	startCall(run, part.id, `readDiff ${next.path} ${next.hunk}`, {
		action: 'readDiff',
		path: next.path,
		hunkIds: [next.hunk]
	});

	raiseClaims(run, part.id, next.path);
}

/** The second reviewer asks one question on its second read; a subagent searches once and answers. */
function stepSubagent(run: CastRun): void {
	const asker = run.progress.assignments?.find((part) => part.id === 'part-2' && part.status === 'running');
	const asked = run.progress.assignments?.find((part) => part.askedBy);

	if (!asked) {
		const path = asker?.scope[0]?.path;

		if (!asker || !path || callsOf(run, asker.id).length < 2) return;

		const question = `Does anything else call into ${path.slice(path.lastIndexOf('/') + 1)}?`;

		run.progress.assignments = [
			...(run.progress.assignments ?? []),
			{
				id: 'ask-1',
				role: 'subagent',
				title: question,
				reason: `Asked by the reviewer of ${asker.title}`,
				askedBy: asker.id,
				question,
				status: 'running',
				scope: [{ path, hunkIds: [] }],
				startedAt: now()
			}
		];

		return;
	}

	if (asked.status !== 'running') return;

	if (finishCall(run, asked.id, '2 callers')) {
		setPart(run, asked.id, { status: 'done', completedAt: now(), currentOperation: 'Answered' });

		return;
	}

	const symbol = asked.scope[0].path.slice(asked.scope[0].path.lastIndexOf('/') + 1).replace(/\..*$/, '');

	startCall(run, asked.id, `rg -n "from './${symbol}'"`, {
		action: 'search',
		query: symbol,
		path: asked.scope[0].path
	});
}

/** One beat of the reading: each reviewer moves, the subagent too; true while anyone still reads. */
export function readBeat(run: CastRun): boolean {
	for (const part of run.progress.assignments ?? [])
		if (part.status === 'running' && !part.askedBy) stepReviewer(run, part);

	stepSubagent(run);

	return (run.progress.assignments ?? []).some((part) => part.status === 'running');
}

/** Drops the candidates validation rejects before anyone verifies them. */
export function dropInvalid(run: CastRun): void {
	for (const [index, claim] of run.claims.entries()) {
		const found = candidate(run, `c${index + 1}`);

		if (!claim.drop || !found || found.state !== 'raised') continue;

		putCandidate(run, {
			...found,
			state: 'dropped',
			dropStage: claim.drop,
			message: 'Points at a line the change does not touch; dropped',
			settledAt: now()
		});
	}
}

/** One beat of a verification: read the code, then run it, then the verdict. */
function stepVerification(run: CastRun, task: ReviewTask): void {
	const found = candidate(run, task.candidateId ?? '');

	if (!found) return;

	const calls = callsOf(run, task.id).length;

	finishCall(
		run,
		task.id,
		calls === 1 ? `${found.path.slice(found.path.lastIndexOf('/') + 1)}:${found.line}` : 'exit 1'
	);

	if (calls === 0) {
		startCall(run, task.id, `read ${found.path}:${found.line}`, {
			action: 'readFile',
			path: found.path,
			startLine: found.line
		});

		return;
	}

	if (calls === 1) {
		const command = `bun test -t "${found.title}"`;

		setTask(run, { ...task, message: 'Running code' });
		startCall(run, task.id, `$ ${command}`, { action: 'run', command, path: found.path });

		return;
	}

	const proven = run.claims.find((claim) => claim.title === found.title)?.proven ?? false;
	const message = proven ? 'Verified by a run' : 'Disproved; dropped';

	setTask(run, { ...task, status: 'done', message });
	putCandidate(run, { ...found, state: proven ? 'proven' : 'unproven', message, settledAt: now() });
}

/** One beat of the check: each lane moves its candidate on, and a free lane takes the next; true while any is left. */
export function verifyBeat(run: CastRun): boolean {
	const tasks = () => Object.values(run.progress.tasks).filter((task) => task.kind === 'verification');

	for (const task of tasks()) if (task.status === 'running') stepVerification(run, task);

	const busy = new Set(
		tasks()
			.filter((task) => task.status === 'running')
			.map((task) => task.verifierId)
	);

	for (let lane = 1; lane <= LANES; lane++) {
		const verifierId = `verifier-${lane}`;
		const next = run.progress.candidates?.find((item) => item.state === 'raised');

		if (busy.has(verifierId) || !next) continue;

		setTask(run, {
			id: `verify:${next.id}`,
			label: `Verify: ${next.title}`,
			status: 'running',
			message: 'Reading code',
			kind: 'verification',
			candidateId: next.id,
			verifierId,
			assignmentId: next.raisedBy
		});

		putCandidate(run, { ...next, state: 'verifying', verifierId });
	}

	return tasks().some((task) => task.status === 'running');
}
