<script lang="ts">
	import { onDestroy } from 'svelte';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as AlertDialog from '@sivir-ui/svelte/components/alert-dialog';
	import { Progress } from '@sivir-ui/svelte/components/progress';
	import Shortcut from '@sivir-ui/svelte/components/shortcut';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import { TaskSteps, type TaskStep } from '@sivir-ui/svelte/components/task-steps';

	interface Props {
		title: string;
		repo: string;
		/** When set, a completion action linking out (sandbox use). */
		sessionHref?: string;
		onDone?: () => void;
	}

	let { title, repo, sessionHref, onDone = () => {} }: Props = $props();

	interface AgentSim {
		id: string;
		name: string;
		model: string;
		/** Independent completion speed — subagents run in parallel. */
		rate: number;
		status: 'queued' | 'running' | 'done';
		progress: number;
		logs: string[];
		findings: number;
	}

	const LOG_SCRIPTS: Record<string, string[]> = {
		security: [
			'cloning acme/ledger-api@feat/rate-limit',
			'diff loaded · 6 files · +89 −34',
			'tracing bucket ownership across tenants',
			'gateway.ts:88 passes raw IP — flagging',
			'checking refill path for time oracle',
			'writing finding F-01 · tenant budget drain'
		],
		perf: [
			'diff loaded · 6 files · +89 −34',
			'profiling hot paths in limiter.ts',
			'buckets Map has no eviction — unbounded growth',
			'measuring constructor allocation cost',
			'writing finding F-02 · missing eviction'
		],
		correctness: [
			'diff loaded · 6 files · +89 −34',
			'checking Clock injection vs Date.now',
			'refill() bypasses injected clock — flagging',
			'verifying bucket invariants',
			'writing finding F-03 · dead clock'
		],
		docs: [
			'diff loaded · 6 files · +89 −34',
			'scanning comments against new signatures',
			'allow() doc predates class move — flagging',
			'writing finding F-04 · stale doc comment'
		]
	};

	function initialAgents(): AgentSim[] {
		return [
			{ id: 'security', name: 'security', model: '32b', rate: 4.2, status: 'running', progress: 2, logs: [], findings: 0 },
			{ id: 'perf', name: 'perf', model: '7b', rate: 6.5, status: 'running', progress: 2, logs: [], findings: 0 },
			{ id: 'correctness', name: 'correctness', model: '32b', rate: 3.4, status: 'running', progress: 2, logs: [], findings: 0 },
			{ id: 'docs', name: 'docs', model: '7b', rate: 7.5, status: 'running', progress: 2, logs: [], findings: 0 }
		];
	}

	let agents = $state<AgentSim[]>(initialAgents());
	let elapsed = $state(0);
	let notified = false;
	let timer: ReturnType<typeof setInterval> | undefined;
	let clock: ReturnType<typeof setInterval> | undefined;

	const overall = $derived(
		Math.round(agents.reduce((sum, a) => sum + a.progress, 0) / agents.length)
	);
	const findingsTotal = $derived(agents.reduce((sum, a) => sum + a.findings, 0));
	const doneCount = $derived(agents.filter((a) => a.status === 'done').length);
	const done = $derived(doneCount === agents.length);

	const stages: TaskStep[] = [
		{ id: 'fetch', label: 'Fetch diff', meta: '+89 −34' },
		{ id: 'review', label: 'Agents reviewing' },
		{ id: 'ready', label: 'Ready' }
	];
	const stageCurrent = $derived(done ? stages.length : 1);

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
					agent.findings = 1 + Math.floor(Math.random() * 2);
				} else if (agent.progress > 55 && agent.findings === 0 && Math.random() > 0.6) {
					agent.findings = 1;
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

	onDestroy(stop);

	function formatElapsed(total: number): string {
		const m = Math.floor(total / 60);
		const s = total % 60;
		return `${m}:${String(s).padStart(2, '0')}`;
	}
</script>

<div
	class="mx-auto flex min-h-[calc(100vh-52px-6rem)] w-full max-w-2xl flex-col justify-center px-4 py-10"
	style="justify-content: safe center"
>
	<div class="flex items-center gap-3">
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-2.5">
				{#if !done}
					<Spinner size={18} aria-hidden="true" />
				{/if}
				<h1 class="truncate text-2xl font-semibold tracking-tight">{title}</h1>
			</div>
		</div>
		<Button
			variant="ghost"
			size="icon"
			aria-label="Restart review"
			title="Restart review"
			onclick={() => (restartOpen = true)}
		>
			<RotateCw size={15} />
		</Button>
	</div>

	<div class="mt-4">
		<TaskSteps steps={stages} current={stageCurrent} label="Review stages" />
	</div>

	<div class="mt-4 flex items-baseline gap-3">
		<div class="min-w-0 flex-1">
			<Progress value={overall} max={100} />
		</div>
		<span class="shrink-0 font-mono text-[13px]">{overall}%</span>
	</div>
	<p class="mt-1.5 font-mono text-[13px] text-foreground-muted">
		{repo} · {doneCount} of {agents.length} agents done · {findingsTotal} findings · {formatElapsed(
			elapsed
		)} elapsed
	</p>

	<div class="mt-6 divide-y divide-border border-y border-border">
		{#each agents as agent (agent.id)}
			<div class="py-3">
				<div class="flex items-center gap-2.5">
					{#if agent.status === 'running'}
						<Spinner size={14} aria-hidden="true" />
					{:else}
						<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-success"></span>
					{/if}
					<span class="text-[15px] font-medium">{agent.name}</span>
					<span class="font-mono text-[12px] text-foreground-muted">{agent.model}</span>
					<span class="ml-auto shrink-0 font-mono text-[13px] text-foreground-muted">
						{agent.status === 'done'
							? `${agent.findings} finding${agent.findings === 1 ? '' : 's'}`
							: `${Math.round(agent.progress)}%`}
					</span>
				</div>
				<div class="mt-2 flex items-center gap-3 pl-[22px]">
					<div class="min-w-0 flex-1">
						<Progress value={agent.progress} max={100} />
					</div>
				</div>
				<p class="mt-1.5 truncate pl-[22px] font-mono text-[13px] text-foreground-muted">
					{#if agent.logs.length === 0}
						<span class="opacity-60">Starting…</span>
					{:else}
						› {agent.logs[agent.logs.length - 1]}
					{/if}
				</p>
			</div>
		{/each}
	</div>

	{#if done && sessionHref}
		<div class="mt-6 flex justify-center">
			<Button href={sessionHref} class="font-sans">Open session</Button>
		</div>
	{/if}

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
</div>
