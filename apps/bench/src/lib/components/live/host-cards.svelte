<script lang="ts">
	import * as Card from '@sivir-ui/svelte/components/card';
	import type { HostStatus } from '$lib/reports/types';

	let { hosts }: { hosts: HostStatus[] } = $props();

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
	{#each hosts as host (host.id)}
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
