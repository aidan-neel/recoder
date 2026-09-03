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

	const viewAgents = $derived(
		agents.map((agent) => ({
			id: agent.id,
			name: agent.name,
			model: agent.model,
			status: agent.status,
			progress: agent.progress,
			findings: revealed(agent).length,
			logs: agent.logs,
			doneMeta:
				agent.status === 'done'
					? `done · ${revealed(agent).length} finding${revealed(agent).length === 1 ? '' : 's'} · ${formatElapsed(agent.doneAt ?? elapsed)}`
					: null
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
	agents={viewAgents}
	findings={viewFindings}
	{pendingCount}
	{onOpenDiff}
	onRestart={() => (restartOpen = true)}
	doneHref={sessionHref}
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
