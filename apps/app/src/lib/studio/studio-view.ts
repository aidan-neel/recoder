import {
	ORCHESTRATOR_ID,
	type ReviewAssignment,
	type ReviewCandidate,
	type ReviewProgress,
	type ReviewTask,
	type ReviewTaskKind,
	type ReviewToolCall
} from '@recoder/shared';

/**
 * Studio's cast and floor, read from the review's progress. Everything that
 * reads as status (who works where, what each one does, how far a file is,
 * what became of a claim) comes from a field the server sent; nothing here is
 * timed or guessed.
 */

type StudioRole = 'lead' | 'reviewer' | 'subagent' | 'verifier';

export type StudioVerb =
	'queued' | 'waiting' | 'reading' | 'searching' | 'running' | 'thinking' | 'idle' | 'done' | 'failed';

export interface StudioAgent {
	/** The assignment id, the verification lane (`verifier-1`), or `lead` for the orchestrator. */
	id: string;
	role: StudioRole;
	/** `O`, `R1`, `S1`, `V1`: the name on its chip. */
	short: string;
	name: string;
	/** The colour it wears, a chart token. */
	hue: string;
	verb: StudioVerb;
	/** The file its newest tool call is in, while it works. */
	path: string | null;
	/** What it does now, as the server words it: the command it runs, or its current operation. */
	say: string | null;
	askedBy: string | null;
	question: string | null;
	/** A verifier: the candidate it checks now. */
	candidateId: string | null;
	/** The ids it posts tool calls under: the assignment, a verifier's verification tasks, or none for the orchestrator. */
	owners: string[];
}

/** A file of the plan or one a tool call touched: the hunks its reviewers were given, and how many of them were read. */
export interface StudioFile {
	path: string;
	folder: string;
	hunks: number;
	read: number;
	done: boolean;
}

export interface StudioRoom {
	folder: string;
	files: StudioFile[];
	done: boolean;
}

/** A step a candidate went through, each from one event. */
export type StepKind = 'raised' | 'traced' | 'ran' | 'checked' | 'proven' | 'dropped' | 'merged';

export interface ChainStep {
	id: string;
	kind: StepKind;
	/** The agent that took the step; none for a drop the pipeline made itself. */
	agent: string | null;
	at: string;
	/** How many calls the step folds together, for a traced, ran or checked step. */
	count: number;
	/** The server's words for a verdict or a drop. */
	detail: string | null;
}

/**
 * What Studio keeps across updates, because the stream keeps only the newest
 * 300 tool calls: the hunks read, the files any call touched and finished
 * with, and the steps each verifier took.
 */
export interface StudioMemory {
	hunks: Set<string>;
	files: Set<string>;
	touched: Set<string>;
	visited: Set<string>;
	steps: Map<string, { candidate: string; kind: 'traced' | 'ran' | 'checked'; at: string }>;
}

/** What runs in the sandbox now: a reviewer's or verifier's command, else the checkout or checks the pipeline runs there. */
interface SandboxWork {
	text: string;
	command: boolean;
}

export interface StudioView {
	agents: StudioAgent[];
	rooms: StudioRoom[];
	candidates: ReviewCandidate[];
	chains: Map<string, ChainStep[]>;
	sandbox: SandboxWork | null;
}

const REVIEWER_HUES = ['--chart-1', '--chart-2', '--chart-5', '--chart-6'];

const VERIFY_PREFIX = 'verify:';

export function createMemory(): StudioMemory {
	return { hunks: new Set(), files: new Set(), touched: new Set(), visited: new Set(), steps: new Map() };
}

function stepKind(call: ReviewToolCall): 'traced' | 'ran' | 'checked' {
	const action = call.input?.action ?? '';

	if (action === 'run') return 'ran';
	if (['readDiff', 'readFile', 'read', 'search', 'listFiles', 'grep'].includes(action) || call.input?.path)
		return 'traced';

	return 'checked';
}

/** Folds the stream's tool calls into the memory: the files they touch, finished diff reads, and every call a verifier made. */
export function remember(memory: StudioMemory, calls: ReviewToolCall[]): void {
	for (const call of calls) {
		const owner = call.assignmentId ?? '';
		const touched = call.input?.path;

		if (touched) memory.touched.add(touched);
		if (touched && call.status !== 'running') memory.visited.add(touched);

		if (owner.startsWith(VERIFY_PREFIX) && !memory.steps.has(call.id))
			memory.steps.set(call.id, {
				candidate: owner.slice(VERIFY_PREFIX.length),
				kind: stepKind(call),
				at: call.startedAt
			});

		if (call.status !== 'done' || call.input?.action !== 'readDiff' || !call.input.path) continue;

		const { path, hunkIds = [] } = call.input;

		if (hunkIds.length === 0) memory.files.add(path);

		for (const hunk of hunkIds) memory.hunks.add(`${path}\n${hunk}`);
	}
}

function folderOf(path: string): string {
	const cut = path.lastIndexOf('/');

	return cut === -1 ? '.' : path.slice(0, cut);
}

/**
 * The files the plan hands out, each once, with the hunks read so far, then the
 * files a tool call touched outside the plan, grouped by folder in that order.
 * A touched file has no hunks to count and is read once a call on it finished.
 */
function roomsOf(assignments: ReviewAssignment[], memory: StudioMemory): StudioRoom[] {
	const files = new Map<string, Set<string>>();

	for (const assignment of assignments) {
		if (assignment.askedBy || assignment.role === 'subagent') continue;

		for (const scope of assignment.scope) {
			const hunks = files.get(scope.path) ?? new Set<string>();

			for (const hunk of scope.hunkIds) hunks.add(hunk);
			files.set(scope.path, hunks);
		}
	}

	for (const path of memory.touched) if (!files.has(path)) files.set(path, new Set());

	const rooms = new Map<string, StudioRoom>();

	for (const [path, hunks] of files) {
		const whole = memory.files.has(path) || (hunks.size === 0 && memory.visited.has(path));
		const read = whole ? hunks.size : [...hunks].filter((hunk) => memory.hunks.has(`${path}\n${hunk}`)).length;
		const done = whole || (hunks.size > 0 && read === hunks.size);
		const folder = folderOf(path);
		const room = rooms.get(folder) ?? { folder, files: [], done: true };

		room.files.push({ path, folder, hunks: hunks.size, read, done });
		room.done = room.done && done;
		rooms.set(folder, room);
	}

	return [...rooms.values()];
}

/** What a working agent does: the kind of call it has running, else it waits on its model's turn, which reads as thinking. */
function verbOf(call: ReviewToolCall | undefined): StudioVerb {
	if (call?.status !== 'running') return 'thinking';
	if (call.input?.action === 'run') return 'running';

	return call.input?.action === 'search' ? 'searching' : 'reading';
}

const SETTLED: Partial<Record<ReviewAssignment['status'], StudioVerb>> = {
	queued: 'queued',
	waiting: 'waiting',
	done: 'done',
	error: 'failed',
	skipped: 'failed'
};

/** The orchestrator's calls carry no assignment, or its own conversation's id. */
const LEAD_OWNERS = ['', ORCHESTRATOR_ID];

/**
 * Each owner's newest tool call, and the file of its newest call that named
 * one, so a search or a command keeps it where it was reading. The
 * orchestrator's are under `lead`.
 */
interface Calls {
	newest: Map<string, ReviewToolCall>;
	place: Map<string, string>;
}

function callsOf(progress: ReviewProgress): Calls {
	const newest = new Map<string, ReviewToolCall>();
	const place = new Map<string, string>();

	for (const call of progress.toolCalls ?? []) {
		const owner = call.assignmentId ?? '';
		const key = LEAD_OWNERS.includes(owner) ? 'lead' : owner;

		newest.set(key, call);
		if (call.input?.path) place.set(key, call.input.path);
	}

	return { newest, place };
}

function assignmentAgent(assignment: ReviewAssignment, short: string, hue: string, calls: Calls): StudioAgent {
	const call = calls.newest.get(assignment.id);
	const settled = SETTLED[assignment.status];
	const working = !settled;

	return {
		id: assignment.id,
		role: assignment.askedBy || assignment.role === 'subagent' ? 'subagent' : 'reviewer',
		short,
		name: assignment.title,
		hue,
		verb: settled ?? verbOf(call),
		path: working ? (calls.place.get(assignment.id) ?? null) : null,
		say: working && call?.status === 'running' ? call.command : (assignment.currentOperation ?? null),
		askedBy: assignment.askedBy ?? null,
		question: assignment.question ?? null,
		candidateId: null,
		owners: [assignment.id]
	};
}

/** The verification lanes the tasks name, each with the candidate it checks now. */
function verifiers(tasks: ReviewTask[], candidates: ReviewCandidate[], calls: Calls): StudioAgent[] {
	const lanes = new Map<string, ReviewTask[]>();

	for (const task of tasks) {
		if (task.kind !== 'verification' || !task.verifierId) continue;

		lanes.set(task.verifierId, [...(lanes.get(task.verifierId) ?? []), task]);
	}

	return [...lanes.entries()]
		.sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
		.map(([lane, own], index) => {
			const task = own.find((item) => item.status === 'running');
			const candidate = candidates.find((item) => item.id === task?.candidateId);
			const call = task ? calls.newest.get(task.id) : undefined;

			return {
				id: lane,
				role: 'verifier',
				short: `V${index + 1}`,
				name: `Verifier ${index + 1}`,
				hue: 'var(--chart-3)',
				verb: task ? verbOf(call) : 'idle',
				path: task ? (calls.place.get(task.id) ?? candidate?.path ?? null) : null,
				say: task ? (call?.status === 'running' ? call.command : task.message) : null,
				askedBy: null,
				question: null,
				candidateId: task?.candidateId ?? null,
				owners: own.map((item) => item.id)
			} satisfies StudioAgent;
		});
}

/** The pipeline's own steps that run in the review checkout: fetching and checking it out, setting it up, the checks. */
const SANDBOX_KINDS: ReviewTaskKind[] = ['checkout', 'setup', 'checks'];

/** The orchestrator's own tasks running now, newest first: none of them belong to a reviewer or a verifier. */
function leadTasks(progress: ReviewProgress): ReviewTask[] {
	return Object.values(progress.tasks)
		.filter((task) => task.status === 'running' && !task.assignmentId && task.kind !== 'verification')
		.sort((a, b) => (b.activityAt ?? b.updatedAt).localeCompare(a.activityAt ?? a.updatedAt));
}

/**
 * The orchestrator, there from the pipeline's first task: at the file its own
 * call reads, thinking while it understands, plans or writes the summary, and
 * in the sandbox while it checks the change out or runs the checks. Between
 * its steps it waits in the commons. Before any task it is not there yet.
 */
function leadAgent(progress: ReviewProgress, calls: Calls): StudioAgent | null {
	const tasks = leadTasks(progress);
	const call = calls.newest.get('lead');

	if (Object.keys(progress.tasks).length === 0 && !call) return null;

	const busy = call?.status === 'running';
	const thinking = tasks.find((task) => !SANDBOX_KINDS.includes(task.kind ?? 'other'));
	const checking = tasks.find((task) => SANDBOX_KINDS.includes(task.kind ?? 'other'));
	const verb: StudioVerb = busy ? verbOf(call) : thinking ? 'thinking' : checking ? 'running' : 'idle';

	return {
		id: 'lead',
		role: 'lead',
		short: 'O',
		name: 'Orchestrator',
		hue: 'var(--text-muted)',
		verb,
		path: busy || thinking ? (calls.place.get('lead') ?? null) : null,
		say: busy ? call.command : (thinking ?? checking)?.message || null,
		askedBy: null,
		question: null,
		candidateId: null,
		owners: LEAD_OWNERS
	};
}

function castOf(progress: ReviewProgress, calls: Calls): StudioAgent[] {
	const assignments = progress.assignments ?? [];
	let reviewers = 0;
	let subagents = 0;

	const cast = assignments.map((assignment) => {
		if (assignment.askedBy || assignment.role === 'subagent') {
			subagents += 1;

			return assignmentAgent(assignment, `S${subagents}`, 'var(--chart-4)', calls);
		}

		reviewers += 1;

		return assignmentAgent(
			assignment,
			`R${reviewers}`,
			`var(${REVIEWER_HUES[(reviewers - 1) % REVIEWER_HUES.length]})`,
			calls
		);
	});

	const lead = leadAgent(progress, calls);

	return [
		...(lead ? [lead] : []),
		...cast,
		...verifiers(Object.values(progress.tasks), progress.candidates ?? [], calls)
	];
}

const VERDICT: Partial<Record<ReviewCandidate['state'], StepKind>> = {
	proven: 'proven',
	unproven: 'dropped',
	dropped: 'dropped',
	merged: 'merged'
};

/** A candidate's steps in order: raised, each kind of check its verifier made, then the verdict. */
function chainOf(candidate: ReviewCandidate, memory: StudioMemory): ChainStep[] {
	const steps: ChainStep[] = [
		{ id: 'raised', kind: 'raised', agent: candidate.raisedBy ?? null, at: candidate.raisedAt, count: 1, detail: null }
	];

	for (const [id, step] of memory.steps) {
		if (step.candidate !== candidate.id) continue;

		const last = steps.at(-1);

		if (last?.kind === step.kind) {
			last.count += 1;
			continue;
		}

		steps.push({ id, kind: step.kind, agent: candidate.verifierId ?? null, at: step.at, count: 1, detail: null });
	}

	const verdict = VERDICT[candidate.state];

	if (verdict) {
		steps.push({
			id: 'verdict',
			kind: verdict,
			agent: candidate.dropStage ? null : (candidate.verifierId ?? null),
			at: candidate.settledAt ?? candidate.raisedAt,
			count: 1,
			detail: candidate.message ?? candidate.dropStage ?? null
		});
	}

	return steps;
}

export function studioView(progress: ReviewProgress, memory: StudioMemory): StudioView {
	const calls = callsOf(progress);
	const candidates = progress.candidates ?? [];

	const running = (progress.toolCalls ?? []).findLast(
		(call) => call.status === 'running' && call.input?.action === 'run'
	);

	const checking = leadTasks(progress).find((task) => SANDBOX_KINDS.includes(task.kind ?? 'other'));

	return {
		agents: castOf(progress, calls),
		rooms: roomsOf(progress.assignments ?? [], memory),
		candidates,
		chains: new Map(candidates.map((candidate) => [candidate.id, chainOf(candidate, memory)])),
		sandbox: running?.input?.command
			? { text: running.input.command, command: true }
			: checking?.message
				? { text: checking.message, command: false }
				: null
	};
}
