<script lang="ts">
	import ArrowDownRight from '@lucide/svelte/icons/arrow-down-right';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import type { FindingLocation } from '@recoder/shared';
	import { getLocationNav } from '$lib/diff/location-nav';
	import { fileIconUrl } from '$lib/diff/material-icons';
	import { relatedLinks } from '$lib/findings/related-locations';

	/**
	 * A finding's related locations as links: one in the diff scrolls there, one outside it shows the location and
	 * why it can't. Where no pane provides navigation (a preview), they list as plain locations.
	 */
	let { locations }: { locations: FindingLocation[] | undefined } = $props();

	const nav = getLocationNav();
	const links = $derived(relatedLinks(locations, nav?.files() ?? null));
</script>

{#if links.length}
	<div class="related-locations">
		<Typography.Metadata class="related-locations-label">Related</Typography.Metadata>
		<ul class="related-locations-list">
			{#each links as link, i (i)}
				{@const icon = fileIconUrl(link.file.slice(link.file.lastIndexOf('/') + 1))}
				{@const title = `${link.file}${link.line === null ? '' : `:${link.line}`}${link.side === 'old' ? ' (before)' : ''}`}
				<li class="related-location-item">
					{#if nav && !link.reason}
						<Button
							variant="ghost"
							class="related-location"
							{title}
							aria-label="Go to {title} in the diff"
							onclick={() => nav.open(link.file, link.line, link.side)}
						>
							<img src={icon} alt="" width="14" height="14" />
							<span class="min-w-0 truncate">{link.label}</span>
							<ArrowDownRight size={13} class="related-location-arrow" aria-hidden="true" />
						</Button>
					{:else}
						<span class="related-location" data-static {title}>
							<img src={icon} alt="" width="14" height="14" />
							<span class="min-w-0 truncate">{link.label}</span>
						</span>
						{#if nav && link.reason}<Typography.Metadata class="related-location-reason"
								>{link.reason}</Typography.Metadata
							>{/if}
					{/if}
				</li>
			{/each}
		</ul>
	</div>
{/if}
