<script lang="ts">
	import { goto } from '$app/navigation';
	import { linear, ticks, timeTick, timeTicks } from '$lib/charts/scale';
	import { pointerIn, type Tip } from '$lib/charts/tip';
	import type { XyPoint } from '$lib/charts/types';
	import ChartTip from './chart-tip.svelte';

	let {
		points,
		label,
		lines = false,
		time = false,
		categories,
		yMax = 1,
		xFormat,
		yFormat = (value: number) => `${Math.round(value * 100)}%`,
		height = 240
	}: {
		points: XyPoint[];
		/** What the chart shows, for screen readers. */
		label: string;
		/** Joins the points of each series in x order. */
		lines?: boolean;
		/** The x values are epoch milliseconds. */
		time?: boolean;
		/** Turns y into rows: each point's y is an index into this list. */
		categories?: string[];
		yMax?: number;
		/** Formats x ticks; time axes default to dates and hours. */
		xFormat?: (value: number) => string;
		yFormat?: (value: number) => string;
		height?: number;
	} = $props();

	const ROW = 26;
	const HIT_PX = 28;

	let width = $state(0);
	let frame = $state<HTMLDivElement>();
	/** Raw, so the template can match it to a plotted point by identity. */
	let active = $state.raw<XyPoint | null>(null);

	const margin = $derived({ top: 12, right: 18, bottom: 28, left: categories ? 128 : 42 });
	const chartHeight = $derived(categories ? categories.length * ROW + margin.top + margin.bottom : height);

	const xDomain = $derived.by((): [number, number] => {
		const xs = points.map((point) => point.x);

		if (!xs.length) return [0, 1];

		if (!time) return [0, ticks(Math.max(...xs), 5).at(-1)!];

		const [low, high] = [Math.min(...xs), Math.max(...xs)];
		const pad = Math.max((high - low) * 0.04, 3_600_000);

		return [low - pad, high + pad];
	});

	const xTicks = $derived(time ? timeTicks(xDomain[0], xDomain[1], width > 700 ? 6 : 4) : ticks(xDomain[1], 5));
	const yTicks = $derived(categories ? [] : ticks(yMax, 4));
	const yTop = $derived(categories ? categories.length - 0.5 : yTicks.at(-1)!);
	const yBottom = $derived(categories ? -0.5 : 0);

	const x = $derived(linear(xDomain, [margin.left, Math.max(margin.left + 1, width - margin.right)]));
	const y = $derived(linear([yBottom, yTop], [chartHeight - margin.bottom, margin.top]));

	/** Each series' points as one path, in x order. */
	const paths = $derived.by(() => {
		if (!lines) return [];

		const groups: Record<string, XyPoint[]> = {};

		for (const point of points) (groups[point.series] ??= []).push(point);

		return Object.values(groups)
			.filter((group) => group.length > 1)
			.map((group) => {
				const sorted = group.toSorted((a, b) => a.x - b.x);

				return {
					key: sorted[0]!.series,
					color: sorted[0]!.color,
					d: sorted.map((point, index) => `${index ? 'L' : 'M'}${x(point.x)},${y(point.y)}`).join(' ')
				};
			});
	});

	const tip = $derived<Tip | null>(
		active ? { x: x(active.x), y: y(active.y), title: active.title, rows: active.rows, below: y(active.y) < 80 } : null
	);

	function nearest(event: PointerEvent): void {
		if (!frame) return;

		const at = pointerIn(frame, event);
		let best: XyPoint | null = null;
		let bestDistance = HIT_PX;

		for (const point of points) {
			const distance = Math.hypot(x(point.x) - at.x, y(point.y) - at.y);

			if (distance < bestDistance) [best, bestDistance] = [point, distance];
		}

		active = best;
	}

	function open(): void {
		if (active?.href) void goto(active.href);
	}

	/**
	 * Hover and click on the plot. A mouse shortcut only: the table view lists
	 * and links every point, so the chart stays an image to assistive tech.
	 */
	function pointer(svg: SVGSVGElement): () => void {
		const leave = () => (active = null);

		svg.addEventListener('pointermove', nearest);
		svg.addEventListener('pointerleave', leave);
		svg.addEventListener('click', open);

		return () => {
			svg.removeEventListener('pointermove', nearest);
			svg.removeEventListener('pointerleave', leave);
			svg.removeEventListener('click', open);
		};
	}
</script>

<div class="chart" bind:this={frame} bind:clientWidth={width}>
	<svg width={width || '100%'} height={chartHeight} role="img" aria-label={label} {@attach pointer}>
		{#if width}
			<g class="chart-grid">
				{#each yTicks as tick (tick)}
					<line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
				{/each}
				{#each categories ?? [] as _, index (index)}
					<line x1={margin.left} x2={width - margin.right} y1={y(index)} y2={y(index)} />
				{/each}
			</g>
			<line
				class="chart-baseline"
				x1={margin.left}
				x2={width - margin.right}
				y1={chartHeight - margin.bottom}
				y2={chartHeight - margin.bottom}
			/>
			<g class="chart-axis">
				{#each yTicks as tick (tick)}
					<text x={margin.left - 8} y={y(tick)} text-anchor="end" dominant-baseline="middle">{yFormat(tick)}</text>
				{/each}
				{#each categories ?? [] as category, index (index)}
					<text x={margin.left - 10} y={y(index)} text-anchor="end" dominant-baseline="middle">
						{category.length > 18 ? `${category.slice(0, 17)}…` : category}
					</text>
				{/each}
				{#each xTicks as tick (tick)}
					<text x={x(tick)} y={chartHeight - 8} text-anchor="middle"
						>{(xFormat ?? (time ? timeTick : String))(tick)}</text
					>
				{/each}
			</g>
			{#if active}
				<line
					class="chart-crosshair"
					x1={x(active.x)}
					x2={x(active.x)}
					y1={margin.top}
					y2={chartHeight - margin.bottom}
				/>
			{/if}
			{#each paths as path (path.key)}
				<path
					class="chart-line"
					d={path.d}
					stroke={path.color}
					opacity={active && active.series !== path.key ? 0.3 : 1}
				/>
			{/each}
			{#each points as point, index (index)}
				<circle
					class="chart-dot"
					cx={x(point.x)}
					cy={y(point.y)}
					r="4.5"
					fill={point.color}
					style:stroke={point.hollow ? point.color : undefined}
					data-hollow={point.hollow || undefined}
					data-active={active === point || undefined}
					opacity={active && active.series !== point.series ? 0.35 : 1}
				/>
			{/each}
			<rect class="chart-hit" data-link={active?.href ? true : undefined} x="0" y="0" {width} height={chartHeight} />
		{/if}
	</svg>
	<ChartTip {tip} />
</div>
