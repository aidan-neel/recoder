'use client';

import type { UsageWindow } from '@recoder/shared';
import { Meter, Pill, Skeleton, type MeterTone } from '@recoder/ui';

import { useProviderLimits, type LimitsView } from '@/lib/settings/providers/use-provider-limits';
import { span } from '@/lib/shell/format';
import { useNow } from '@/lib/shell/use-now';

import { DetailBlock } from './detail-block';

/** The reset times tick over once a minute. */
const TICK_MS = 60_000;

/** A window at or past these shares of its limit is worth noticing. */
const HIGH_PERCENT = 90;
const MEDIUM_PERCENT = 70;

/** The placeholder windows while the limits load: a label and its track. */
const SKELETON_WINDOWS = 2;

/**
 * The provider's usage limits: each window its account meters, how much of
 * it is used and when it resets, with the plan beside the title. A provider
 * whose limits Recoder can't read shows nothing.
 */
export function ProviderUsage({ providerKey }: { providerKey: string }) {
	const limits = useProviderLimits(providerKey);

	if (limits.status === 'unsupported') return null;

	const plan = limits.status === 'ready' ? limits.plan : null;

	return (
		<DetailBlock title="Usage" aside={plan ? <Pill>{plan}</Pill> : null}>
			<UsageBody limits={limits} />
		</DetailBlock>
	);
}

/** The windows, their placeholders while loading, or why there are none. */
function UsageBody({ limits }: { limits: Exclude<LimitsView, { status: 'unsupported' }> }) {
	if (limits.status === 'loading') return <UsageSkeleton />;
	if (limits.status === 'signed-out') return <p className="detail-text">Sign in to see this provider’s limits.</p>;
	if (limits.status === 'error') return <p className="detail-text row-problem">{limits.reason}</p>;
	if (limits.windows.length === 0) return <p className="detail-text">The provider reports no limits.</p>;

	return <UsageWindows windows={limits.windows} />;
}

/**
 * A model provider's usage under its row in OpenCode's details: its windows
 * once they are read, and nothing while loading or when there are none to
 * show, so rows without limits stay one line.
 */
export function CompactUsage({ providerKey }: { providerKey: string }) {
	const limits = useProviderLimits(providerKey);

	if (limits.status !== 'ready' || limits.windows.length === 0) return null;

	return <UsageWindows windows={limits.windows} compact />;
}

/** The windows a provider meters, one under the next; `compact` tightens them under a row. */
function UsageWindows({ windows, compact }: { windows: readonly UsageWindow[]; compact?: boolean }) {
	return (
		<ul className="usage-windows" data-compact={compact || undefined}>
			{windows.map((window) => (
				<UsageRow key={window.label} window={window} />
			))}
		</ul>
	);
}

/** One window: its name and share used over the track, and when it resets under it. */
function UsageRow({ window }: { window: UsageWindow }) {
	const now = useNow(TICK_MS);
	const used = Math.round(window.usedPercent);
	const resets = window.resetsAt ? Date.parse(window.resetsAt) - now : Number.NaN;

	return (
		<li className="usage-window">
			<span className="usage-window-label">{window.label}</span>
			<span className="usage-window-used">{used}% used</span>
			<Meter value={used} max={100} tone={toneOf(used)} aria-label={`${window.label} usage`} />
			<span className="usage-window-reset">{resetText(resets)}</span>
		</li>
	);
}

/** Placeholder windows the same height as the ones that replace them. */
function UsageSkeleton() {
	return (
		<ul className="usage-windows" aria-hidden>
			{Array.from({ length: SKELETON_WINDOWS }, (_, index) => (
				<li key={index} className="usage-window">
					<Skeleton className="usage-skeleton-label" />
					<Skeleton className="usage-skeleton-track" />
				</li>
			))}
		</ul>
	);
}

function toneOf(used: number): MeterTone {
	if (used >= HIGH_PERCENT) return 'high';
	if (used >= MEDIUM_PERCENT) return 'medium';

	return 'neutral';
}

/** "Resets in 3 hours"; "Resets soon" once the time has passed; nothing when the provider does not say. */
function resetText(ms: number): string {
	if (Number.isNaN(ms)) return '';

	return ms > TICK_MS ? `Resets in ${span(ms)}` : 'Resets soon';
}
