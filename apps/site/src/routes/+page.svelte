<script lang="ts">
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as CodeBlock from '@sivir-ui/svelte/components/code-block';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import HeroDemo from '$lib/components/hero-demo.svelte';
	import WaitlistForm from '$lib/components/waitlist-form.svelte';

	const repo = 'https://github.com/aidan-neel/recoder';
	const install = 'git clone https://github.com/aidan-neel/recoder && cd recoder && docker compose up --build';
	const headline = ['Recoder reviews your pull requests.', 'It runs on your own machine, with the models you choose.'];
	/** Index of a sentence's first word, so the reveal staggers across both sentences. */
	const words = (sentence: number) => headline.slice(0, sentence).reduce((n, text) => n + text.split(' ').length, 0);


	const description = headline.join(' ');
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

<div class="site-column">
	<section aria-labelledby="site-title">
		<Typography.Title level={1} id="site-title" class="home-brief site-brief ai-voice" aria-label={description}>
			{#each headline as sentence, s (s)}
				<span class={s === 0 ? 'text-fg' : undefined} aria-hidden="true">
					{#each sentence.split(' ') as word, w (w)}
						<span class="hero-word" style={`--w: ${words(s) + w}`}>{word}</span>{' '}
					{/each}
				</span>
			{/each}
		</Typography.Title>
		<div class="hero-rise mt-[22px] flex flex-wrap items-start gap-2" style="--d: 0">
			<Button href={repo} class="brief-action">Self-host on GitHub <ArrowUpRight size={14} aria-hidden="true" /></Button>
			<WaitlistForm />
		</div>
	</section>

	<div class="site-install hero-rise" style="--d: 1">
		<CodeBlock.Root code={install} lang="bash" copy="inline" class="install-command" />
	</div>

	<div class="hero-stage mt-14">
		<div class="hero-glow" aria-hidden="true"></div>
		<div class="relative z-[1]">
			<HeroDemo />
		</div>
	</div>
</div>
