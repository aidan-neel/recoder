<script lang="ts">
	import * as AlertDialog from '@sivir-ui/svelte/components/alert-dialog';
	import Shortcut from '@sivir-ui/svelte/components/shortcut';
	import ReviewingView, {
		type ReviewingFinding
	} from '$lib/components/reviewing-view.svelte';

	interface Props {
		title: string;
		repo: string;
		prLabel?: string | null;
		files?: number | null;
		additions?: number | null;
		deletions?: number | null;
		/** When set, a completion action linking out (sandbox use). */
		sessionHref?: string;
		onOpenDiff?: (() => void) | null;
		onDone?: () => void;
	}

	let {
		title,
		repo,
		prLabel = null,
		files = null,
		additions = null,
		deletions = null,
		sessionHref,
		onOpenDiff = null,
		onDone = () => {}
	}: Props = $props();

	interface AgentSim {
		id: string;
		name: string;
		model: string;
		/** Independent completion speed — subagents run in parallel. */
		rate: number;
		status: 'queued' | 'running' | 'done';
		progress: number;
		doneAt: number | null;
		logs: string[];
	}

	interface ScriptedFinding {
		severity: ReviewingFinding['severity'];
		title: string;
		location: string;
	}

	const LOG_SCRIPTS: Record<string, string[]> = {
		security: [
			'cloning acme/recoder@release/v0.2.9',
			'diff loaded · 13 files · +1204 −318',
			'gateway.ts:88 passes raw IP — flagging',
			'checking refill path for time oracle',
			'writing finding F-01 · tenant budget drain'
		],
		correctness: [
			'diff loaded · 13 files · +1204 −318',
			'checking Clock injection vs Date.now',
			'refill() bypasses injected clock — flagging',
			'verifying bucket invariants',
			'writing finding F-03 · dead clock'
		],
		perf: [
			'diff loaded · 13 files · +1204 −318',
			'profiling hot paths in limiter.ts',
			'buckets Map has no eviction — unbounded growth',
			'measuring constructor allocation cost',
			'writing finding F-02 · missing eviction'
		],
		docs: [
			'diff loaded · 13 files · +1204 −318',
			'scanning comments against new signatures',
			'allow() doc predates class move — flagging',
			'writing finding F-04 · stale doc comment'
		]
	};

	const FINDING_SCRIPTS: Record<string, ScriptedFinding[]> = {
		security: [
			{ severity: 'high', title: 'Tenant budget drain via raw IP bucket key', location: 'gateway.ts:88' },
			{ severity: 'medium', title: 'Refill window leaks bucket state across tenants', location: 'limiter.ts:44' }
		],
		perf: [
			{ severity: 'medium', title: 'buckets Map has no eviction — unbounded growth', location: 'limiter.ts:24' }
		],
		correctness: [
			{ severity: 'medium', title: 'refill() reads Date.now, ignoring injected clock', location: 'limiter.ts:61' }
		],
		docs: [
			{ severity: 'low', title: 'allow() doc comment predates the class move', location: 'limiter.ts:12' }
		]
	};

	function initialAgents(): AgentSim[] {
		return [
			{ id: 'security', name: 'security', model: 'qwen3.8-flash', rate: 4.2, status: 'running', progress: 2, doneAt: null, logs: [] },
			{ id: 'perf', name: 'perf', model: 'qwen3.8-flash', rate: 6.5, status: 'running', progress: 2, doneAt: null, logs: [] },
			{ id: 'correctness', name: 'correctness', model: 'qwen3.8-flash', rate: 3.4, status: 'running', progress: 2, doneAt: null, logs: [] },
			{ id: 'docs', name: 'docs', model: 'qwen3.8-flash', rate: 7.5, status: 'running', progress: 2, doneAt: null, logs: [] }
		];
	}

	let agents = $state<AgentSim[]>(initialAgents());
	let elapsed = $state(0);
	let notified = false;
	let timer: ReturnType<typeof setInterval> | undefined;
	let clock: ReturnType<typeof setInterval> | undefined;

	function revealed(agent: AgentSim): ScriptedFinding[] {
		const script = FINDING_SCRIPTS[agent.id] ?? [];
		if (agent.status === 'done') return script;
		return script.slice(0, Math.min(script.length, Math.floor(agent.progress / 35)));
	}

	const viewAssignments = $derived(
		agents.map((agent) => ({
			id: `${agent.id}-demo`,
			role: agent.id,
			title: agent.name === 'patterns' ? 'Repository consistency' : agent.name,
			reason: 'Demo specialist assignment',
			status: agent.status === 'done' ? 'done' as const : agent.status === 'running' ? 'running' as const : 'queued' as const,
			scope: [{ path: 'src/rate-limit/limiter.ts', hunkIds: [] }],
			model: agent.model,
			candidateCount: revealed(agent).length,
			currentOperation: agent.logs.at(-1) ?? 'Reviewing demo changes',
			elapsedMs: agent.progress * 40
		}))
	);

	const viewFindings = $derived.by(() => {
		const out: ReviewingFinding[] = [];
		let n = 0;
		for (const agent of agents) {
			for (const finding of revealed(agent)) {
				n += 1;
				out.push({
					id: `F-${String(n).padStart(2, '0')}`,
					agent: agent.name,
					severity: finding.severity,
					title: finding.title,
					location: finding.location
				});
			}
		}
		return out;
	});

	const pendingCount = $derived(agents.filter((a) => a.status !== 'done').length);

	const viewTasks = $derived(
		agents.map((agent) => ({
			id: `${agent.id}-task`,
			label: 'Specialist review',
			status: agent.status === 'done' ? ('done' as const) : ('running' as const),
			message: agent.logs.at(-1) ?? 'Reviewing demo changes',
			assignmentId: `${agent.id}-demo`,
			agent: agent.id,
			batch: Math.max(1, Math.min(3, Math.ceil(agent.progress / 34))),
			batches: 3,
			elapsedMs: agent.progress * 40,
			updatedAt: new Date().toISOString()
		}))
	);

	const viewReasoning = $derived(
		agents.flatMap((agent) =>
			agent.logs.length
				? [
						{
							id: `${agent.id}-reason`,
							assignmentId: `${agent.id}-demo`,
							role: agent.id,
							model: agent.model,
							at: new Date().toISOString(),
							text: agent.logs.join('\n')
						}
					]
				: []
		)
	);

	const viewTools = $derived(
		agents.flatMap((agent) => [
			{
				id: `${agent.id}-t1`,
				assignmentId: `${agent.id}-demo`,
				role: agent.id,
				command: `rg -n ${JSON.stringify(agent.id)} src/rate-limit`,
				status: 'done' as const,
				exitCode: 0,
				startedAt: new Date().toISOString(),
				elapsedMs: 31,
				summary: '3 matches'
			},
			{
				id: `${agent.id}-t2`,
				assignmentId: `${agent.id}-demo`,
				role: agent.id,
				command: `read limiter.ts:61-84`,
				status: agent.status === 'done' ? ('done' as const) : ('running' as const),
				exitCode: agent.status === 'done' ? 0 : null,
				startedAt: new Date().toISOString(),
				elapsedMs: agent.progress * 30
			}
		])
	);

	let restartOpen = $state(false);

	function confirmRestart() {
		restartOpen = false;
		start();
	}

	function stop() {
		if (timer) clearInterval(timer);
		if (clock) clearInterval(clock);
		timer = undefined;
		clock = undefined;
	}

	function start() {
		stop();
		agents = initialAgents();
		elapsed = 0;
		notified = false;
		clock = setInterval(() => (elapsed += 1), 1000);
		timer = setInterval(() => {
			let allDone = true;
			for (const agent of agents) {
				if (agent.status !== 'running') {
					if (agent.status !== 'done') allDone = false;
					continue;
				}
				allDone = false;
				agent.progress = Math.min(100, agent.progress + agent.rate * (0.5 + Math.random()));
				const script = LOG_SCRIPTS[agent.id];
				const line =
					script[Math.min(script.length - 1, Math.floor((agent.progress / 100) * script.length))];
				if (agent.logs[agent.logs.length - 1] !== line) agent.logs.push(line);
				if (agent.progress >= 100) {
					agent.status = 'done';
					agent.doneAt = elapsed;
				}
			}
			if (allDone) {
				stop();
				if (!notified) {
					notified = true;
					onDone();
				}
			}
		}, 400);
	}

	$effect(() => {
		start();
		return stop;
	});

	function formatElapsed(total: number): string {
		const m = Math.floor(total / 60);
		const s = total % 60;
		return `${m}:${String(s).padStart(2, '0')}`;
	}
</script>

<ReviewingView
	title={title}
	meta={{
		prLabel: prLabel ?? '',
		repo,
		files,
		additions,
		deletions,
		elapsed: formatElapsed(elapsed)
	}}
	assignments={viewAssignments}
	findings={viewFindings}
	tasks={viewTasks}
	reasoning={viewReasoning}
	toolCalls={viewTools}
	pipelineLogs={agents.flatMap((agent) => agent.logs)}
	{pendingCount}
	{onOpenDiff}
	onRestart={() => (restartOpen = true)}
	doneHref={sessionHref}
	stage={pendingCount ? 2 : 4}
	stageLabel={pendingCount ? 'Specialist review' : 'Review complete'}
	active={pendingCount > 0}
/>

<AlertDialog.Root bind:open={restartOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Restart review?</AlertDialog.Title>
			<AlertDialog.Description>
				Agent progress and streamed logs start over from zero.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Exit>
				Cancel
				<Shortcut shortcut="esc" />
			</AlertDialog.Exit>
			<AlertDialog.Confirm variant="primary" onclick={confirmRestart}>
				Restart
				<Shortcut shortcut="enter" />
			</AlertDialog.Confirm>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
