<script lang="ts">
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import Skeleton from '../ui/skeleton.svelte';
	import type { SettingsSection } from '$lib/settings/model-settings.svelte';

	interface Props {
		section: SettingsSection;
	}

	/** A settings section's rows while its config loads: Agent mirrors its Models, CLI and Providers lists. */
	let { section }: Props = $props();
</script>

<div class="flex flex-col gap-6" role="status" aria-label="Loading settings">
	<section class="settings-section" aria-hidden="true">
		{#if section === 'models'}<Typography.H3 class="settings-label">Models</Typography.H3>{:else}<div
				class="flex h-[17.5px] items-center"
			>
				<Skeleton class="h-3 w-24" />
			</div>{/if}
		<Card.Root class="settings-list">
			{#each section === 'models' ? [0, 1] : [0, 1, 2, 3, 4] as i (i)}
				<div class="settings-row">
					<div class="flex min-w-0 flex-1 flex-col gap-1.5">
						<Skeleton class="h-3" w={[28, 36, 24, 32, 26][i]} unit="%" /><Skeleton
							class="h-2.5"
							w={[44, 38, 30, 34, 40][i]}
							unit="%"
						/>
					</div>
					<Skeleton class="h-3 w-24" />
				</div>
			{/each}
		</Card.Root>
	</section>
	{#if section === 'models'}
		<section class="settings-section" aria-hidden="true">
			<Typography.H3 class="settings-label">CLI</Typography.H3>
			<Card.Root class="settings-list">
				<div class="settings-row">
					<div class="flex min-w-0 flex-1 flex-col gap-1.5">
						<Skeleton class="h-3" w={16} unit="%" /><Skeleton class="h-2.5" w={46} unit="%" />
					</div>
					<Skeleton class="h-[22px] w-12" />
				</div>
			</Card.Root>
		</section>
		<section class="settings-section" aria-hidden="true">
			<Typography.H3 class="settings-label">Providers</Typography.H3>
			<Card.Root class="settings-list">
				{#each [0, 1, 2] as i (i)}
					<div class="settings-row">
						<div class="flex min-w-0 flex-1 flex-col gap-1.5">
							<Skeleton class="h-3" w={[18, 22, 16][i]} unit="%" /><Skeleton
								class="h-2.5"
								w={[26, 30, 24][i]}
								unit="%"
							/>
						</div>
						<Skeleton class="h-[26px] w-20" />
					</div>
				{/each}
			</Card.Root>
		</section>
	{/if}
</div>
