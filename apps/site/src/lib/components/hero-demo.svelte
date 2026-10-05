<script lang="ts">
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Check from '@lucide/svelte/icons/check';
	import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
	import Inbox from '@lucide/svelte/icons/inbox';
	import LoaderCircle from '@lucide/svelte/icons/loader';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import * as Avatar from '@sivir-ui/svelte/components/avatar';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Conversation from '@sivir-ui/svelte/components/conversation';
	import { Markdown } from '@sivir-ui/svelte/components/markdown';
	import * as Message from '@sivir-ui/svelte/components/message';
	import { Progress } from '@sivir-ui/svelte/components/progress';
	import Shortcut from '@sivir-ui/svelte/components/shortcut';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import * as Tabs from '@sivir-ui/svelte/components/tabs';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import FindingSeverity from '$web/components/findings/finding-severity.svelte';
	import ReasoningTrace from '$web/components/review/reasoning-trace.svelte';
	import ReviewComposer from '$web/components/review/review-composer.svelte';
	import ReviewSteps from '$web/components/review/review-steps.svelte';
	import ReviewToolCallView from '$web/components/review/review-tool-call.svelte';
	import SessionHeader from '$web/components/session/session-header.svelte';
	import Disclosure from '$web/components/ui/disclosure.svelte';
	import ThoughtLabel from '$web/components/ui/thought-label.svelte';
	import { taskGroupLabel } from '$web/review/review-transcript';
	import { keepPillAligned } from '$web/shell/tab-pill';
	import { DEMO_END, DEMO_HOLD, DEMO_LOOP, demoState, findingCounts, request } from '$lib/demo-script';
	import type { ReviewToolCall } from '@recoder/shared';

	let t = $state(0);
	let fading = $state(false);
	let playing = $state(false);
	let rootEl = $state<HTMLElement>();
	const demo = $derived(demoState(t));

	/** The window is laid out at desktop size and scaled down to fit narrower screens. */
	let stageWidth = $state(0);
	let naturalWidth = $state(0);
	let naturalHeight = $state(0);
	const scale = $derived(naturalWidth && stageWidth ? Math.min(1, stageWidth / naturalWidth) : 1);
	/** Root font scale (app.css raises it on large monitors); JS px constants follow it. */
	let rootScale = $state(1);
	/** Narrow screens drop the rail and lay the window out at tablet width, so it scales down less. */
	const compact = $derived(stageWidth > 0 && stageWidth < 900 * rootScale);

	onMount(() => {
		rootScale = parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1;

		const reduce = matchMedia('(prefers-reduced-motion: reduce)');
		let visible = true;
		let start = performance.now();
		let pausedAt: number | null = null;
		let timer = 0;

		function frame(now: number) {
			const elapsed = now - start;

			if (elapsed >= DEMO_LOOP) {
				start = now;
				fading = false;
				t = 0;
			} else {
				fading = elapsed >= DEMO_END + DEMO_HOLD;
				t = Math.min(elapsed, DEMO_END);
			}

			timer = window.setTimeout(() => requestAnimationFrame(frame), 50);
		}

		function play() {
			if (reduce.matches || !visible || document.hidden) return pause();
			if (playing) return;
			playing = true;
			if (pausedAt !== null) start += performance.now() - pausedAt;
			pausedAt = null;
			requestAnimationFrame(frame);
		}

		function pause() {
			if (!playing) return;
			playing = false;
			pausedAt = performance.now();
			clearTimeout(timer);
		}

		function sync() {
			if (reduce.matches) {
				pause();
				fading = false;
				t = DEMO_END;
			} else play();
		}

		const io = new IntersectionObserver(([entry]) => {
			visible = entry.isIntersecting;
			sync();
		});

		if (rootEl) io.observe(rootEl);
		document.addEventListener('visibilitychange', sync);
		reduce.addEventListener('change', sync);
		sync();

		return () => {
			pause();
			io.disconnect();
			document.removeEventListener('visibilitychange', sync);
			reduce.removeEventListener('change', sync);
		};
	});

	/** Every loop restarts from an empty transcript, so keyed blocks replay their enter motion. */
	const loop = $derived(t < 100 ? 0 : 1);

	/** A tool row's time, from the script's elapsed ms. */
	function duration(tool: ReviewToolCall): string {
		const ms = tool.elapsedMs ?? 0;

		return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
	}
</script>

{#snippet tabIcon(running: boolean)}
	<span class="flex shrink-0 items-center" style:color={running ? 'var(--sev-medium)' : 'var(--success)'}>
		{#if running}<LoaderCircle size={12} strokeWidth={1.75} class="spin" aria-hidden="true" />
		{:else}<GitPullRequest size={13} strokeWidth={1.75} aria-hidden="true" />{/if}
	</span>
{/snippet}

{#snippet finalFacts()}
	<div class="fact-rows">
		<Typography.Text class="fact-row"
			><span class="fact-label">Findings</span><span class="fact-value">5 kept, 1 merged as a duplicate</span
			></Typography.Text
		>
		<Typography.Text class="fact-row"
			><span class="fact-label">Coverage</span><span class="fact-value font-mono">41 / 43 hunks</span></Typography.Text
		>
	</div>
{/snippet}

<div
	class="demo-stage"
	bind:clientWidth={stageWidth}
	style:height={naturalHeight ? `${naturalHeight * scale}px` : undefined}
>
	<div
		bind:this={rootEl}
		class="demo-window"
		style:scale={scale === 1 ? undefined : String(scale)}
		bind:offsetWidth={naturalWidth}
		bind:offsetHeight={naturalHeight}
		data-compact={compact || undefined}
		inert
	>
		<header class="top-bar flex h-[46px] shrink-0 items-center gap-1 bg-chrome pr-[10px] pl-2 select-none">
			<nav class="relative flex min-w-0 flex-1 items-center">
				<Tabs.Root value="ledger" variant="segmented" class="top-tabs min-w-0">
					<Tabs.List {@attach keepPillAligned}>
						<Tabs.Trigger value="home">
							<Inbox size={14} strokeWidth={1.75} aria-hidden="true" />
							Home
							<span class="font-mono text-[11.5px] text-fg-faint">4</span>
						</Tabs.Trigger>
						<span class="tab-sep mx-1.5 h-4 w-px shrink-0 bg-line-tab" aria-hidden="true"></span>
						<Tabs.Trigger value="ledger">
							{@render tabIcon(!demo.finished)}
							<span class="whitespace-nowrap">ledger-api</span>
							<span class="font-mono text-[11.5px] text-fg-faint">#4127</span>
							{#if demo.finished}
								<span class="tab-badge" data-tone="high">1 high</span>
							{:else if demo.progress}
								<span class="tab-badge" data-tone="running">{demo.reviewers.done}/{demo.reviewers.total}</span>
							{/if}
						</Tabs.Trigger>
						<Tabs.Trigger value="sivir">
							{@render tabIcon(false)}
							<span class="whitespace-nowrap">sivir-ui</span>
							<span class="font-mono text-[11.5px] text-fg-faint">#160</span>
							<span class="tab-badge">2</span>
						</Tabs.Trigger>
						<Tabs.Trigger value="gateway">
							<span class="flex shrink-0 items-center" style:color="var(--danger)"
								><GitPullRequest size={13} strokeWidth={1.75} aria-hidden="true" /></span
							>
							<span class="whitespace-nowrap">gateway</span>
							<span class="font-mono text-[11.5px] text-fg-faint">#902</span>
							<span class="tab-badge" data-tone="failed">failed</span>
						</Tabs.Trigger>
					</Tabs.List>
				</Tabs.Root>
				<Button variant="ghost" size="icon" class="top-plus" aria-label="Review a pull request"
					><Plus size={14} aria-hidden="true" /></Button
				>
			</nav>
			<Button variant="quiet" class="search-trigger">
				<Search size={14} aria-hidden="true" />
				<span class="min-w-0 flex-1 truncate text-left">Search or ask Recoder</span>
				<Shortcut shortcut="cmd+k" class="keycap" />
			</Button>
			<Button variant="ghost" class="usage-meter">
				<Progress value={38} class="usage-track h-[3px] w-[26px] rounded-[2px] bg-hover" />
				38%
			</Button>
			<Button variant="ghost" size="icon" aria-label="Settings"
				><SlidersHorizontal size={15} aria-hidden="true" /></Button
			>
			<Button variant="quiet" size="icon" class="top-avatar-trigger" aria-label="Account">
				<Avatar.Root class="size-[26px] bg-selected text-[10.5px] font-medium text-fg-secondary">
					<Avatar.Fallback>AN</Avatar.Fallback>
				</Avatar.Root>
			</Button>
		</header>

		<div class="flex min-h-0 flex-1 px-2 pb-2">
			<Card.Root
				class="app-canvas min-h-0 min-w-0 flex-1 gap-0 overflow-hidden rounded-[14px] border border-line-canvas bg-canvas p-0 shadow-none"
			>
				<div class="flex h-full min-h-0 flex-col">
					<SessionHeader
						title="Move rate limiter into a class with injectable clock"
						repo="acme/ledger-api"
						prLabel="#4127"
						view="conversation"
						onView={() => {}}
					/>
					<div class="demo-body flex min-h-0 flex-1" data-fading={fading || undefined}>
						<div class="relative flex min-h-0 min-w-0 flex-1 flex-col">
							<div class="review-chat">
								<Conversation.Root class="min-h-0 w-full flex-1">
									<Conversation.Content transcriptClass="review-transcript" class="![scrollbar-gutter:auto]">
										{#key loop}
											{#if demo.user}
												<div class="enter-rise" style:--i="0">
													<Message.Root from="user" status="idle" class="[--font-weight-body:400]">
														<Message.Content class="review-bubble">{request}</Message.Content>
													</Message.Root>
												</div>
											{/if}

											{#if demo.reasoning}
												<div class="enter-rise" style:--i="0">
													<Disclosure status={demo.reasoning.running ? 'running' : undefined}>
														{#snippet label()}{demo.reasoning?.running
																? 'Reviewing changes…'
																: 'Reviewed changes for 4s'}{/snippet}
														<Markdown content={demo.reasoning.text} />
													</Disclosure>
												</div>
											{/if}

											{#if demo.toolCalls.length}
												<div class="enter-rise" style:--i="0">
													<Disclosure
														open={demo.toolsOpen}
														status={demo.toolsRunning ? 'running' : 'done'}
														class="review-tool-group"
														bodyClass="!gap-0"
													>
														{#snippet label()}{taskGroupLabel(demo.toolCalls)}{/snippet}
														{#each demo.toolCalls as tool (tool.id)}
															<div class="enter-rise" style:--i="0">
																<ReviewToolCallView {tool} duration={duration(tool)} active />
															</div>
														{/each}
													</Disclosure>
												</div>
											{/if}

											{#if demo.plan}
												<Message.Root
													from="assistant"
													status={demo.plan.streaming ? 'streaming' : 'idle'}
													class="[--font-weight-body:400]"
												>
													<Message.Content class="review-prose ai-voice">
														<Markdown content={demo.plan.text} streaming={demo.plan.streaming} />
													</Message.Content>
												</Message.Root>
											{/if}

											{#if demo.unitWork}
												{@const work = demo.unitWork}
												<div class="enter-rise" style:--i="0">
													<Disclosure class="work-log" bodyClass="!gap-1">
														{#snippet label()}
															<ThoughtLabel working={work.working} time={work.time} doing="Working" done="Worked" />
															{#if work.doing}<span class="work-log-note">· {work.doing}</span>{/if}
														{/snippet}
														<Disclosure size="sm" bodyClass="thought-body !gap-3">
															{#snippet label()}<ThoughtLabel
																	working={work.thought.working}
																	time={work.thought.time}
																/>{/snippet}
															<ReasoningTrace text={work.thought.text} streaming={work.thought.working} />
														</Disclosure>
														{#each work.tools as tool (tool.id)}
															<ReviewToolCallView {tool} duration={duration(tool)} active />
														{/each}
													</Disclosure>
												</div>
											{/if}

											{#if demo.agents.length}
												<section class="agents enter-rise" style:--i="0" aria-label="Agents">
													<Disclosure>
														{#snippet label()}Started 1 subagent{/snippet}
														{#each demo.agents as item (item.id)}
															<Typography.Text
																><span class="text-fg-secondary">Subagent:</span> {item.name}</Typography.Text
															>
														{/each}
													</Disclosure>
													{#if !demo.agentsFinished}
														<ul class="agent-list" aria-label="Agents" out:slide={{ duration: 280 }}>
															{#each demo.agents as item, i (item.id)}
																<li class="enter-rise" style:--i={i}>
																	<Button variant="ghost" class="agent-row">
																		<span class="agent-main">
																			<span class="agent-name-line">
																				<span class="agent-row-name">{item.name}</span>
																				<span class="agent-model">{item.model}</span>
																			</span>
																			<span class="agent-op">{item.current}</span>
																		</span>
																		<Badge
																			variant="secondary"
																			class="status-chip"
																			data-tone={item.status === 'done'
																				? 'success'
																				: item.status === 'running'
																					? 'running'
																					: 'idle'}
																		>
																			{#if item.status === 'running'}<Spinner size={12} aria-hidden="true" />{/if}
																			{item.status === 'done'
																				? 'Finished'
																				: item.status === 'running'
																					? 'Reviewing'
																					: 'Queued'}
																		</Badge>
																	</Button>
																</li>
															{/each}
														</ul>
													{/if}
												</section>
											{/if}

											{#if demo.progress}
												<div class="enter-rise" style:--i="0">
													<Disclosure
														status={demo.progress.running ? 'running' : 'done'}
														bodyClass="finalize-body"
														children={demo.progress.running ? undefined : finalFacts}
													>
														{#snippet label()}{demo.progress?.label}{/snippet}
													</Disclosure>
												</div>
											{/if}

											{#if demo.thinking}
												<Typography.Text role="status" class="review-thinking"
													><span class="shimmer-text">Thinking</span></Typography.Text
												>
											{/if}

											{#if demo.summary}
												<Message.Root
													from="assistant"
													status={demo.summary.streaming ? 'streaming' : 'idle'}
													class="[--font-weight-body:400]"
												>
													<Message.Content class="review-prose ai-voice">
														<Markdown content={demo.summary.text} streaming={demo.summary.streaming} />
													</Message.Content>
												</Message.Root>
											{/if}

											{#if demo.finished}
												<div class="enter-rise" style:--i="0">
													<Card.Root class="review-result">
														<span class="review-result-mark" aria-hidden="true"
															><Check size={14} strokeWidth={2.25} /></span
														>
														<div class="review-result-text">
															<Typography.Text class="review-result-title">Review finished</Typography.Text>
															<Typography.Metadata class="review-result-meta"
																>{demo.findings.length} findings · 2m 14s · 7 files</Typography.Metadata
															>
															<div class="review-result-pills" aria-label="Findings by severity">
																{#each findingCounts(demo.findings) as item (item.severity)}<FindingSeverity
																		severity={item.severity}
																		count={item.count}
																	/>{/each}
															</div>
														</div>
														<Button class="shrink-0 gap-2"
															>Open findings <ArrowUpRight size={14} aria-hidden="true" /></Button
														>
													</Card.Root>
												</div>
											{/if}
										{/key}
									</Conversation.Content>
								</Conversation.Root>

								<div class="review-dock">
									<div class="review-dock-inner">
										<ReviewComposer
											label="Message Orchestrator"
											placeholder={demo.finished ? 'Ask a follow-up about this review…' : 'Ask Orchestrator anything…'}
											onSubmit={() => {}}
											onAttach={() => {}}
										/>
									</div>
								</div>
							</div>
						</div>

						<aside class="results-rail demo-rail" aria-label="Review progress">
							<div class="results-rail-body">
								{#key loop}
									{#if !demo.finished}
										<div out:slide={{ duration: 240 }}>
											<ReviewSteps
												current={demo.stage}
												active={!demo.finished}
												elapsed={demo.elapsed}
												reviewers={demo.reviewers}
												subagents={demo.subagents}
											/>
										</div>
									{/if}

									{#if demo.findings.length}
										<div class="enter-rise" style:--i="0">
											<Card.Root class="rail-card">
												<div class="rail-card-head">
													<Typography.Title level={2} class="rail-card-title">Findings</Typography.Title>
													<span class="rail-card-meta">{demo.findings.length}</span>
												</div>
												{#each demo.findings as finding (finding.id)}
													<div class="demo-row-in">
														<Button variant="ghost" class="rail-finding">
															<FindingSeverity severity={finding.severity} />
															<span class="rail-finding-text">
																<span class="rail-finding-title">{finding.title}</span>
																<span class="rail-finding-loc">{finding.location}</span>
															</span>
														</Button>
													</div>
												{/each}
											</Card.Root>
										</div>
									{/if}

									{#if demo.agents.length}
										<div class="enter-rise" style:--i="1">
											<Card.Root class="rail-card">
												<div class="rail-card-head">
													<Typography.Title level={2} class="rail-card-title">Agents</Typography.Title>
													<span class="rail-card-meta">{demo.agentsDone} finished</span>
												</div>
												{#each demo.agents as item (item.id)}
													<Button variant="ghost" class="rail-agent">
														<span class="rail-dot" data-status={item.status} aria-hidden="true"></span>
														<span class="rail-agent-row-name">{item.name}</span>
														<span class="rail-agent-meta"
															>{item.status === 'done' ? `${item.model} · ${item.elapsed}` : item.model}</span
														>
														<span class="rail-agent-count"
															>{demo.findings.filter((finding) => finding.agent === item.id).length}</span
														>
													</Button>
												{/each}
											</Card.Root>
										</div>
									{/if}
								{/key}
							</div>
						</aside>
					</div>
				</div>
			</Card.Root>
		</div>
	</div>
</div>
