'use client';

import { ConfirmDialog } from '@recoder/ui';

import { useGuidelinesEditor } from '@/lib/guidelines/editor-store';

/**
 * The "Discard your changes?" confirm that guards a guidelines editor's
 * unsaved text. Each screen that hosts an editor mounts it.
 */
export function GuidelinesConfirm() {
	const asking = useGuidelinesEditor((state) => state.confirm !== null);

	return (
		<ConfirmDialog
			open={asking}
			onOpenChange={(open) => {
				if (!open) useGuidelinesEditor.getState().settleConfirm(false);
			}}
			title="Discard your changes?"
			description="Your edits to these guidelines will be lost."
			confirmLabel="Discard"
			cancelLabel="Keep editing"
			destructive
			onConfirm={() => useGuidelinesEditor.getState().settleConfirm(true)}
		/>
	);
}
