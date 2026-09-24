<script lang="ts">
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as CodeBlock from '@sivir-ui/svelte/components/code-block';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import HeroDemo from '$lib/components/hero-demo.svelte';
	import WaitlistForm from '$lib/components/waitlist-form.svelte';

	const repo = 'https://github.com/aidan-neel/recoder';
	const install = 'git clone https://github.com/aidan-neel/recoder && cd recoder && docker compose up --build';
	const description = 'Recoder reviews your pull requests. It runs on your own machine, with the models you choose.';
</script>

<svelte:head>
	<title>Recoder</title>
	<meta name="description" content={description} />
	<meta property="og:title" content="Recoder" />
	<meta property="og:description" content={description} />
	<meta property="og:url" content="https://recoder.dev" />
	<meta property="og:type" content="website" />
	<link rel="canonical" href="https://recoder.dev" />
</svelte:head>

<div class="flex min-h-dvh flex-col bg-chrome text-fg">
	<main class="flex flex-1 p-2">
		<Card.Root class="app-canvas min-w-0 flex-1 gap-0 rounded-[14px] border border-line-canvas bg-canvas p-0 shadow-none">
			<div class="site-column">
				<section aria-labelledby="site-title">
					<Typography.Title level={1} id="site-title" class="home-brief site-brief ai-voice enter-rise" style="--i: 0">
						<span class="text-fg">Recoder reviews your pull requests.</span>
						It runs on your own machine, with the models you choose.
					</Typography.Title>
					<div class="enter-rise mt-[22px] flex flex-wrap items-start gap-2" style="--i: 1">
						<Button href={repo} class="brief-action">Self-host on GitHub <ArrowUpRight size={14} aria-hidden="true" /></Button>
						<WaitlistForm />
					</div>
				</section>

				<div class="site-install enter-rise" style="--i: 2">
					<CodeBlock.Root code={install} lang="bash" copy="inline" class="install-command" />
				</div>

				<div class="enter-rise mt-14" style="--i: 3">
					<HeroDemo />
				</div>
			</div>
		</Card.Root>
	</main>
</div>
