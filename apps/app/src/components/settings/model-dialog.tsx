'use client';

import { CommandDialog, CommandEmpty, CommandFooter, CommandInput, CommandList } from '@recoder/ui';

import { ROLE_NAME, type ModelCatalog, type ModelRole } from '@/lib/settings/model-options';
import { useModelDialog } from '@/lib/settings/use-model-dialog';

import { ModelList } from './model-list';

const HINTS = [
	{ keys: ['ArrowUp', 'ArrowDown'], label: 'navigate' },
	{ keys: ['Enter'], label: 'choose' },
	{ keys: ['Escape'], label: 'close' }
];

interface ModelSearchProps {
	role: ModelRole;
	catalog: ModelCatalog;
	/** The pick's row key: the list opens on it, and it carries the check. */
	current: string | null;
	onPick: (id: string) => void;
}

/**
 * The dialog's body. It mounts with each open and holds the search state
 * itself, so the search starts empty and the list lands on the current pick
 * every time. The search field's keys move the selection, because only the
 * rows near the viewport exist for the list to walk.
 */
function ModelSearch({ role, catalog, current, onPick }: ModelSearchProps) {
	const { field, ...search } = useModelDialog({ role, catalog, current });

	return (
		<>
			<div ref={field}>
				<CommandInput
					placeholder={search.searchPlaceholder}
					value={search.query}
					onValueChange={search.setQuery}
					onKeyDown={search.onKeyDown}
					trailing={search.roleName}
				/>
			</div>
			<CommandList>
				<ModelList search={search} current={current} onPick={onPick} />
				{search.layout.rows.length === 0 ? <CommandEmpty>{search.emptyText}</CommandEmpty> : null}
			</CommandList>
			<CommandFooter hints={HINTS} />
		</>
	);
}

interface ModelDialogProps extends ModelSearchProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/** The model dialog: every model grouped by provider, found by any word of its name, provider or id. */
export function ModelDialog({ open, onOpenChange, ...search }: ModelDialogProps) {
	return (
		<CommandDialog
			open={open}
			onOpenChange={onOpenChange}
			label={ROLE_NAME[search.role]}
			shouldFilter={false}
			className="model-dialog"
		>
			<ModelSearch {...search} />
		</CommandDialog>
	);
}
