import type { FileDiff } from '@recoder/shared';

/**
 * What the ⌘K palette can reach in the open session. The session page and
 * findings bar register here while mounted; the palette only reads.
 */
class PaletteContext {
	session = $state<{ id: string; repo: string; pr: number } | null>(null);
	files = $state<FileDiff[]>([]);
	/** Send text to the Orchestrator and show the conversation. */
	ask = $state<((text: string) => Promise<void>) | null>(null);
	showView = $state<((view: 'conversation' | 'diff') => void) | null>(null);
	fixAll = $state<{ count: number; run: () => void } | null>(null);
}

export const paletteContext = new PaletteContext();
