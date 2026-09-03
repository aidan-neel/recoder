<script lang="ts">
	import type { DiffLine, FileDiff } from '$lib/diff';
	import type { Finding, FindingSeverity } from '$lib/findings.svelte';
	import { SEVERITY_DOT, findingsStore } from '$lib/findings.svelte';
	import { highlightLines } from '$lib/highlight';
	import FindingCard from './finding-card.svelte';

	interface Props {
		diff: FileDiff;
		findings?: Finding[];
	}

	let { diff, findings = [] }: Props = $props();

	/** Hunks annotated with how many unchanged lines were skipped before them. */
	const hunks = $derived(
		diff.hunks.map((hunk, i) => {
			const prev = diff.hunks[i - 1];
			const prevEnd = prev ? prev.oldStart + prev.oldCount : hunk.oldStart;
			return { hunk, skipped: Math.max(0, hunk.oldStart - prevEnd) };
		})
	);

	const rowBg: Record<DiffLine['type'], string> = {
		context: '',
		add: 'bg-success/10',
		del: 'bg-error/10'
	};

	/** Per-line highlighted HTML, aligned 1:1 with hunks → lines. */
	const highlighted = $derived(
		diff.hunks.map((h) => highlightLines(h.lines.map((l) => l.text)))
	);

	/** Open findings grouped by the line their card anchors under. */
	const byLine = $derived.by(() => {
		const map = new Map<number, Finding[]>();
		for (const finding of findings) {
			const list = map.get(finding.endLine) ?? [];
			list.push(finding);
			map.set(finding.endLine, list);
		}
		return map;
	});

	/** Strongest open finding per new-side line, for row markers. */
	const lineMarks = $derived.by(() => {
		const rank: Record<FindingSeverity, number> = { high: 0, medium: 1, low: 2, info: 3 };
		const map = new Map<number, Finding>();
		for (const finding of findings) {
			if (finding.status === 'dismissed') continue;
			for (let n = finding.startLine; n <= finding.endLine; n++) {
				const current = map.get(n);
				if (!current || rank[finding.severity] < rank[current.severity]) {
					map.set(n, finding);
				}
			}
		}
		return map;
	});
</script>

<div class="flex min-h-full flex-col">
	<div class="flex h-11 shrink-0 items-center gap-2.5 border-b border-border px-4">
		<span class="truncate font-mono text-[15px] font-medium">{diff.path}</span>
		<span class="shrink-0 font-mono text-[14px]">
			<span class="text-success">+{diff.additions}</span>
			{' '}
			<span class="text-error">-{diff.deletions}</span>
		</span>
	</div>
	<div class="flex-1 py-2 font-mono text-[14px] leading-6">
		{#each hunks as { hunk, skipped }, hi (hi)}
			{#if skipped > 0}
				<div
					class="flex items-center gap-3 px-4 py-1.5 text-[13px] text-foreground-muted/70 select-none"
				>
					<span class="h-px flex-1 bg-border/60"></span>
					<span class="font-mono">
						{skipped} unchanged {skipped === 1 ? 'line' : 'lines'}
					</span>
					<span class="h-px flex-1 bg-border/60"></span>
				</div>
			{/if}
			{#each hunk.lines as line, i (`${line.oldNo}-${line.newNo}-${i}`)}
				{@const key = line.newNo ?? -1}
				{@const mark = lineMarks.get(key)}
				{@const hovered = mark && findingsStore.hoveredId === mark.id}
				<div
					role="row"
					tabindex="-1"
					class="grid w-full grid-cols-[2.75rem_2.75rem_minmax(0,1fr)] {rowBg[line.type]}"
					style:box-shadow={mark
						? `inset ${hovered ? 3 : 2}px 0 0 ${SEVERITY_DOT[mark.severity]}`
						: null}
					onmouseenter={() => (findingsStore.hoveredId = mark?.id ?? null)}
					onmouseleave={() => (findingsStore.hoveredId = null)}
				>
					<span
						class="pr-3 text-right text-foreground-muted/60 select-none"
						style:color={mark ? SEVERITY_DOT[mark.severity] : null}
					>
						{line.oldNo ?? ''}
					</span>
					<span
						class="pr-3 text-right text-foreground-muted/60 select-none"
						style:color={mark ? SEVERITY_DOT[mark.severity] : null}
					>
						{line.newNo ?? ''}
					</span>
					<span class="pr-4 whitespace-pre-wrap break-all min-w-0">
						{#if line.type === 'del'}
							<span class="text-error">-</span>{@html highlighted[hi][i]}
						{:else if line.type === 'add'}
							<span class="text-success">+</span>{@html highlighted[hi][i]}
						{:else}
							<span class="text-foreground-muted/40 select-none">{' '}</span>{@html highlighted[hi][i]}
						{/if}
					</span>
				</div>
				{#each byLine.get(key) ?? [] as finding (finding.id)}
					<div id={`finding-${finding.id}`} class="mx-4 my-1.5 scroll-mt-2 sm:mx-10">
						<FindingCard {finding} />
					</div>
				{/each}
			{/each}
		{/each}
	</div>
</div>
