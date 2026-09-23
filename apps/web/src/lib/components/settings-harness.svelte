<script lang="ts">
	import * as Card from '@sivir-ui/svelte/components/card';
	import { Input } from '@sivir-ui/svelte/components/input';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import { settingsDraft } from '$lib/settings-draft.svelte';

	const FIELDS = [
		{ key: 'maxFiles', name: 'Files per review', desc: 'Larger PRs are reviewed in part', max: 200 },
		{ key: 'maxDiffChars', name: 'Diff characters', desc: 'Total diff sent to reviewers', max: 1_000_000 },
		{ key: 'maxFileChars', name: 'Characters per file', desc: 'Longer files are truncated', max: 200_000 }
	] as const;

	function setLimit(key: (typeof FIELDS)[number]['key'], max: number, raw: string): void {
		const n = Math.round(Number(raw));
		if (Number.isFinite(n) && n > 0) settingsDraft.limits = { ...settingsDraft.limits, [key]: Math.min(n, max) };
	}
</script>

<section class="settings-section" aria-labelledby="harness-limits">
	<Typography.H3 id="harness-limits" class="settings-label">Review limits</Typography.H3>
	<Card.Root class="settings-list">
		{#each FIELDS as field (field.key)}
			<div class="settings-row">
				<div class="min-w-0 flex-1">
					<p class="settings-row-name">{field.name}</p>
					<p class="settings-row-desc">{field.desc}</p>
				</div>
				<div class="settings-number">
					<Input
						type="number"
						min="1"
						max={field.max}
						aria-label={field.name}
						value={settingsDraft.limits[field.key]}
						onchange={(event) => setLimit(field.key, field.max, (event.currentTarget as HTMLInputElement).value)}
					/>
				</div>
			</div>
		{/each}
	</Card.Root>
</section>
