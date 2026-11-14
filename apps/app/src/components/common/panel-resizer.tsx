'use client';

import { ResizeHandle } from '@recoder/ui';

import type { PanelId } from '@/lib/shell/panel-width';
import { usePanelWidth } from '@/lib/shell/use-panel-width';

interface PanelResizerProps {
	panel: PanelId;
	label: string;
}

/** The drag handle on a panel's right edge, wired to that panel's saved width. It alone renders while a drag runs. */
export function PanelResizer({ panel, label }: PanelResizerProps) {
	const { width, spec, resize, commit } = usePanelWidth(panel);

	return (
		<ResizeHandle
			label={label}
			width={width}
			min={spec.min}
			max={spec.max}
			defaultWidth={spec.fallback}
			onResize={resize}
			onResizeEnd={commit}
		/>
	);
}
