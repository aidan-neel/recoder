<script lang="ts">
	import * as Card from '@sivir-ui/svelte/components/card';
	import Skeleton from '$web/components/ui/skeleton.svelte';
	import type { HostStatus } from '$lib/reports/types';

	/** Undefined while the hosts load. */
	let { hosts }: { hosts: HostStatus[] | undefined } = $props();

	function tone(host: HostStatus): 'down' | 'busy' | 'ok' {
		return host.error ? 'down' : host.runs ? 'busy' : 'ok';
	}

	function state(host: HostStatus): string {
		if (host.error) return 'Not reachable';
		if (host.runs) return host.runs === 1 ? '1 run active' : `${host.runs} runs active`;

		return host.servers.length ? 'Idle' : 'No server running';
	}
</script>

<div class="host-cards">
	{#if !hosts}
		{#each [0, 1] as index (index)}
			<Card.Root class="bench-panel">
				<div class="host-card-body">
					<div class="host-card-name"><Skeleton class="my-0.5 h-[17px] w-20" /><Skeleton class="h-3.5 w-24" /></div>
					<div class="host-card-facts flex-col">
						<Skeleton class="my-[2px] h-[13.3px] w-44" />
						<Skeleton class="my-[2px] h-[13.3px] w-10" />
					</div>
				</div>
			</Card.Root>
		{/each}
	{/if}
	{#each hosts ?? [] as host (host.id)}
		<Card.Root class="bench-panel">
			<div class="host-card-body">
				<div class="host-card-name">
					{host.label}
					<span class="status-line"><span class="status-dot" data-tone={tone(host)}></span>{state(host)}</span>
				</div>
				{#if host.error}
					<span class="bench-error">{host.error}</span>
				{:else}
					<div class="host-card-facts">
						<span
							>servers <b>{host.servers.length ? host.servers.map((server) => `:${server.port}`).join(' ') : 'none'}</b
							></span
						>
						<span>reviews <b>{host.reviews}</b></span>
						<span>{host.remote ? 'ssh' : 'local'}</span>
					</div>
				{/if}
			</div>
		</Card.Root>
	{/each}
</div>
