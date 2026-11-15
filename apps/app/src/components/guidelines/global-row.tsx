'use client';

import type { GuidelinesOverview } from '@recoder/shared';

import { useGlobalRow } from '@/lib/guidelines/use-global-row';

import { LayerRow } from './layer-row';

/**
 * The global layer: saved on this machine and applied to every repository.
 * Never saved, it holds Recoder's defaults, which the editor opens on so they
 * can be adjusted and not retyped.
 */
export function GlobalRow({ overview }: { overview: GuidelinesOverview }) {
	return <LayerRow name="Global guidelines" view={useGlobalRow(overview)} />;
}
