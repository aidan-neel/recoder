<script lang="ts">
	import { rowTint } from '$lib/diff/diff-rows';
	import { outsideDiffNote } from '$lib/diff/outside-diff';
	import { SEVERITY_DOT, type Finding } from '$lib/findings/findings.svelte';

	/**
	 * A finding's line that the diff has no row for (no checkout to expand the file): its number and why the code
	 * isn't shown, so the finding's card still has a place in the diff and revealing the line lands here.
	 */
	interface Props {
		startLine: number;
		endLine: number;
		/** The strongest open finding on the line, for the severity bar. */
		mark: Finding | undefined;
		onHover: (id: string | null) => void;
	}

	let { startLine, endLine, mark, onHover }: Props = $props();
</script>

<div
	role="row"
	tabindex="-1"
	data-diff-row
	data-type="outside"
	data-new-no={startLine}
	data-old-no=""
	class="diff-row diff-outside-row"
	style:box-shadow={mark ? `inset 2px 0 0 ${SEVERITY_DOT[mark.severity]}` : null}
	style:--row-tint={mark ? rowTint(SEVERITY_DOT[mark.severity], 12) : null}
	onmouseenter={() => onHover(mark?.id ?? null)}
	onmouseleave={() => onHover(null)}
>
	<span class="diff-num"></span>
	<span class="diff-num" style:color={mark ? SEVERITY_DOT[mark.severity] : null}>{startLine}</span>
	<span class="diff-sign" aria-hidden="true"></span>
	<span class="diff-outside-note">{outsideDiffNote(startLine, endLine)}</span>
</div>
