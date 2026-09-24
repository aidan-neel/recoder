<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import Eye from '@lucide/svelte/icons/eye';
	import FileIcon from '@lucide/svelte/icons/file';
	import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
	import Inbox from '@lucide/svelte/icons/inbox';
	import LoaderCircle from '@lucide/svelte/icons/loader';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Play from '@lucide/svelte/icons/play';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import Wrench from '@lucide/svelte/icons/wrench';
	import * as Command from '@sivir-ui/svelte/components/command';
	import type { FileDiff } from '@recoder/shared';
	import SeverityPill from './ui/severity-pill.svelte';
	import { findingsStore, type Finding } from '$lib/findings.svelte';
	import { modelSettingsUi } from '$lib/model-settings.svelte';
	import { errorToast } from '$lib/notify';
	import { paletteContext } from '$lib/palette.svelte';
	import { recentSessions, timeAgo, type RecentSession } from '$lib/recent-sessions.svelte';
	import { sessionFile } from '$lib/session-file.svelte';
	import { sessionState } from '$lib/session-state.svelte';
	import { shellState } from '$lib/shell-state.svelte';

	const LIMIT = 4;

	let query = $state('');
	/** Search this session, or every session (Tab toggles). */
	let allSessions = $state(false);

	$effect(() => {
		if (shellState.paletteOpen) {
			query = '';
			allSessions = false;
		}
	});

	const session = $derived(paletteContext.session);
	const sessionScope = $derived(!!session && !allSessions);
	const q = $derived(query.trim().toLowerCase());
	const onDiff = $derived(page.url.searchParams.get('view') === 'diff');

	const findings = $derived.by(() => {
		if (!sessionScope) return [];
		const rank = { high: 0, medium: 1, low: 2, info: 3 };
		const list = findingsStore.items.filter(
			(f) => f.status === 'open' && (q === '' || `${f.title} ${f.body} ${f.file}`.toLowerCase().includes(q))
		);
		return list.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, LIMIT);
	});

	/** Path matches first, then files whose diff mentions the query. */
	const files = $derived.by(() => {
		if (!sessionScope || q === '') return [];
		const byPath: { file: FileDiff; matches: number }[] = [];
		const byContent: { file: FileDiff; matches: number }[] = [];
		for (const file of paletteContext.files) {
			if (file.path.toLowerCase().includes(q)) {
				byPath.push({ file, matches: 0 });
				continue;
			}
			let matches = 0;
			for (const hunk of file.hunks) {
				for (const line of hunk.lines) if (line.type !== 'del' && line.text.toLowerCase().includes(q)) matches++;
			}
			if (matches > 0) byContent.push({ file, matches });
		}
		return [...byPath, ...byContent.sort((a, b) => b.matches - a.matches)].slice(0, LIMIT);
	});

	const openIds = $derived(new Set(sessionState.sessions.map((s) => s.id)));
	const sessions = $derived.by(() => {
		if (sessionScope) return [];
		const list = recentSessions.recent.filter(
			(s) => q === '' || `${s.title ?? ''} ${s.repo} #${s.pr} ${s.branch ?? ''}`.toLowerCase().includes(q)
		);
		return [...list.filter((s) => openIds.has(s.id)), ...list.filter((s) => !openIds.has(s.id))].slice(0, q ? 8 : 6);
	});

	const canAsk = $derived(sessionScope && q !== '' && !!paletteContext.ask);

	/** Split text around case-insensitive matches of the query. */
	function hits(text: string): { text: string; hit: boolean }[] {
		if (q === '') return [{ text, hit: false }];
		const out: { text: string; hit: boolean }[] = [];
		const lower = text.toLowerCase();
		let at = 0;
		for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, i + q.length)) {
			if (i > at) out.push({ text: text.slice(at, i), hit: false });
			out.push({ text: text.slice(i, i + q.length), hit: true });
			at = i + q.length;
		}
		if (at < text.length) out.push({ text: text.slice(at), hit: false });
		return out;
	}

	async function ask(text = query.trim()): Promise<void> {
		if (!text || !paletteContext.ask) return;
		shellState.paletteOpen = false;
		try {
			await paletteContext.ask(text);
		} catch (e) {
			errorToast('Could not send to the Orchestrator', e instanceof Error ? e.message : undefined);
		}
	}

	function openFinding(finding: Finding): void {
		paletteContext.showView?.('diff');
		sessionFile.select(finding.file);
		findingsStore.activeId = finding.id;
	}

	function openFile(file: FileDiff): void {
		paletteContext.showView?.('diff');
		sessionFile.select(file.path);
	}

	function openSession(s: RecentSession): void {
		const status = s.status === 'running' || s.status === 'queued' ? 'reviewing' : 'ready';
		sessionState.ensureSession(s.id, s.repo, `#${s.pr}`, status);
		void goto(`/session/${s.id}`);
	}

	async function reviewPullRequest(): Promise<void> {
		await goto('/');
		await tick();
		document.getElementById('home-filter')?.focus();
	}

	/**
	 * ⌘↵ asks, Tab switches scope, and the query is mirrored here. Sivir's search
	 * input owns its own handlers, so listen from the wrapper.
	 */
	function searchKeys(node: HTMLElement): () => void {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				event.stopPropagation();
				void ask();
			} else if (event.key === 'Tab' && session) {
				event.preventDefault();
				allSessions = !allSessions;
			}
		};
		const onInput = (event: Event) => {
			query = (event.target as HTMLInputElement).value;
		};
		node.addEventListener('keydown', onKey, true);
		node.addEventListener('input', onInput);
		return () => {
			node.removeEventListener('keydown', onKey, true);
			node.removeEventListener('input', onInput);
		};
	}

	const sevLabel = { high: 'High', medium: 'Medium', low: 'Low', info: 'Info' } as const;
</script>

{#snippet highlighted(text: string)}
	{#each hits(text) as part, i (i)}{#if part.hit}<mark class="palette-hit">{part.text}</mark>{:else}{part.text}{/if}{/each}
{/snippet}

{#snippet sessionItem(s: RecentSession)}
	{@const title = s.title?.trim() || `PR #${s.pr}`}
	{@const running = s.status === 'running' || s.status === 'queued'}
	<Command.Item value={q} callback={() => openSession(s)}>
		<span class="palette-icon" style:color={running ? 'var(--sev-medium)' : s.status === 'failed' ? 'var(--danger)' : 'var(--success)'}>
			{#if running}<LoaderCircle size={14} class="spin" aria-hidden="true" />{:else}<GitPullRequest size={14} aria-hidden="true" />{/if}
		</span>
		<span class="min-w-0 flex-1 truncate">{@render highlighted(title)}</span>
		<span class="palette-meta font-mono">{s.repo.split('/').at(-1)} #{s.pr}</span>
		<span class="palette-meta w-16 text-right">{timeAgo(s.updatedAt)}</span>
	</Command.Item>
{/snippet}

<Command.Root bind:open={shellState.paletteOpen}>
	<Command.Content class="palette" label="Search or ask Recoder">
		<div class="palette-search" {@attach searchKeys}>
			<Command.Search placeholder={sessionScope ? 'Search this session or ask the Orchestrator' : 'Search sessions and actions'} />
			<span class="palette-scope" aria-live="polite">
				{#if sessionScope && session}in {session.repo} #{session.pr}{:else}all sessions{/if}
			</span>
		</div>
		<Command.Results>
			{#key `${q}|${sessionScope}`}
				{#if canAsk}
					<Command.Item value={q} class="palette-ask" callback={() => void ask()}>
						<MessageSquare size={15} strokeWidth={1.75} class="palette-icon" aria-hidden="true" />
						<span class="min-w-0 flex-1 truncate">Ask Orchestrator: <span class="text-fg-muted">“{query.trim()}”</span></span>
						<kbd class="keycap">⌘↵</kbd>
					</Command.Item>
				{/if}

				{#if findings.length > 0}
					<Command.Group heading="Findings">
						<p class="palette-label" aria-hidden="true">Findings</p>
						{#each findings as finding (finding.id)}
							<Command.Item value={q} callback={() => openFinding(finding)}>
								<SeverityPill tone={finding.severity} class="palette-sev">{sevLabel[finding.severity]}</SeverityPill>
								<span class="min-w-0 flex-1 truncate">{@render highlighted(finding.title)}</span>
								<span class="palette-meta font-mono">{finding.file.split('/').pop()}:{finding.startLine}</span>
							</Command.Item>
						{/each}
					</Command.Group>
				{/if}

				{#if files.length > 0}
					<Command.Group heading="Files">
						<p class="palette-label" aria-hidden="true">Files</p>
						{#each files as { file, matches } (file.path)}
							{@const slash = file.path.lastIndexOf('/') + 1}
							<Command.Item value={q} callback={() => openFile(file)}>
								<FileIcon size={15} strokeWidth={1.75} class="palette-icon" aria-hidden="true" />
								<span class="min-w-0 flex-1 truncate font-mono text-[13px]">
									<span class="text-fg-faint">{@render highlighted(file.path.slice(0, slash))}</span>{@render highlighted(file.path.slice(slash))}
								</span>
								{#if matches > 0}
									<span class="palette-meta">{matches} match{matches === 1 ? '' : 'es'}</span>
								{:else}
									<span class="palette-meta font-mono text-ok">+{file.additions}</span>
								{/if}
							</Command.Item>
						{/each}
					</Command.Group>
				{/if}

				{#if sessions.length > 0}
					<Command.Group heading="Sessions">
						<p class="palette-label" aria-hidden="true">Sessions</p>
						{#each sessions as s (s.id)}{@render sessionItem(s)}{/each}
					</Command.Group>
				{/if}

				<Command.Group heading="Actions">
					<p class="palette-label" aria-hidden="true">Actions</p>
					<Command.Item value={q} callback={() => void reviewPullRequest()}>
						<Play size={14} fill="currentColor" class="palette-icon" aria-hidden="true" />
						<span class="flex-1">Review a pull request…</span>
						<span class="palette-meta">R</span>
					</Command.Item>
					{#if sessionScope && paletteContext.fixAll}
						{@const fixAll = paletteContext.fixAll}
						<Command.Item value={q} callback={() => { paletteContext.showView?.('diff'); fixAll.run(); }}>
							<Wrench size={15} strokeWidth={1.75} class="palette-icon" aria-hidden="true" />
							<span class="flex-1">Fix all open findings</span>
							<span class="palette-meta">{fixAll.count}</span>
						</Command.Item>
					{/if}
					{#if sessionScope && paletteContext.showView}
						{@const show = paletteContext.showView}
						<Command.Item value={q} callback={() => show(onDiff ? 'conversation' : 'diff')}>
							<Eye size={15} strokeWidth={1.75} class="palette-icon" aria-hidden="true" />
							<span class="flex-1">Switch to {onDiff ? 'conversation' : 'diff'}</span>
							<span class="palette-meta">{onDiff ? '⌘1' : '⌘2'}</span>
						</Command.Item>
					{/if}
					{#if page.url.pathname !== '/'}
						<Command.Item value={q} callback={() => void goto('/')}>
							<Inbox size={15} strokeWidth={1.75} class="palette-icon" aria-hidden="true" />
							<span class="flex-1">Go home</span>
						</Command.Item>
					{/if}
					<Command.Item value={q} callback={() => modelSettingsUi.show()}>
						<SlidersHorizontal size={15} strokeWidth={1.75} class="palette-icon" aria-hidden="true" />
						<span class="flex-1">Settings</span>
						<span class="palette-meta">⌘,</span>
					</Command.Item>
				</Command.Group>
			{/key}
		</Command.Results>
		<footer class="palette-footer">
			<span><kbd class="keycap">↑↓</kbd> navigate</span>
			<span><kbd class="keycap">↵</kbd> open</span>
			{#if session}<span><kbd class="keycap">⌘↵</kbd> ask</span>{/if}
			<span class="flex-1"></span>
			{#if session}<span>Tab to search {allSessions ? 'this session' : 'all sessions'}</span>{/if}
		</footer>
	</Command.Content>
</Command.Root>
