/** A linear map from a domain onto a pixel range. */
export function linear(domain: [number, number], range: [number, number]): (value: number) => number {
	const [d0, d1] = domain;
	const [r0, r1] = range;
	const span = d1 - d0 || 1;

	return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}

/** The smallest 1, 2, 2.5 or 5 × 10ⁿ step that splits `max` into at most `count` parts. */
function niceStep(max: number, count: number): number {
	const raw = max / count;
	const power = 10 ** Math.floor(Math.log10(raw));

	return [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((step) => step >= raw) ?? raw;
}

/** Round tick values from 0 up to at least `max`. */
export function ticks(max: number, count = 4): number[] {
	if (max <= 0) return [0, 1];

	const step = niceStep(max, count);
	const top = Math.ceil(max / step) * step;

	return Array.from({ length: Math.round(top / step) + 1 }, (_, index) => Number((index * step).toFixed(6)));
}

const HOUR = 3_600_000;
const STEPS = [1, 2, 3, 6, 12, 24, 48, 72, 168].map((hours) => hours * HOUR);

/** Local midnights or whole hours inside a span, at most about `count` of them, for a time axis. */
export function timeTicks(start: number, end: number, count = 5): number[] {
	const step = STEPS.find((candidate) => (end - start) / candidate <= count) ?? STEPS.at(-1)!;
	const first = new Date(start);

	first.setMinutes(0, 0, 0);
	if (step >= 24 * HOUR) first.setHours(0);

	const values: number[] = [];

	for (let at = first.getTime(); at <= end; at += step) if (at >= start) values.push(at);

	return values;
}

/** A time tick: `Oct 7` at midnight, `14:00` otherwise. */
export function timeTick(ms: number): string {
	const date = new Date(ms);

	if (date.getHours() === 0) return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

	return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}
