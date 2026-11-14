'use client';

import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Skeleton
} from '@recoder/ui';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { useApi } from '@/lib/api/client';
import { ROLE_NAME, type ModelRole } from '@/lib/settings/model-options';
import { useModelPicker, type ModelPickerView } from '@/lib/settings/use-model-picker';

import { ModelDialog } from '@/components/settings/model-dialog';

/** The picks the composer offers: the model that runs reviews and chats, and the one its subagents run on. */
const ROLES = ['orchestrator', 'specialist'] as const satisfies readonly ModelRole[];

/**
 * The models every review and chat runs on, from the composer's bar: a quiet
 * trigger that names the Review model, opening a menu with the Review and
 * Subagent picks and the Review model's effort. A pick opens the same
 * searchable dialog as Settings and saves at once: to Settings for the admin,
 * to the member's own account for a member. While the admin sets a member's
 * models, the menu shows them, changes nothing and says why.
 * The sample has no settings, so it shows nothing there.
 */
export function ComposerModels() {
	const sample = useApi().base !== '';

	if (sample) return null;

	return <ModelMenu />;
}

/** The menu and the dialogs it opens. */
function ModelMenu() {
	const review = useModelPicker('orchestrator');
	const subagent = useModelPicker('specialist');
	const pickers: Record<(typeof ROLES)[number], ModelPickerView> = { orchestrator: review, specialist: subagent };

	if (review.offline) return null;
	if (!review.label) return <Skeleton className="composer-models-loading" />;

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger>
					<Button
						variant="quiet"
						className="composer-models"
						aria-label={`Models: ${review.label.text} reviews, ${subagent.label?.text ?? 'loading'} subagents`}
					>
						<span className="composer-models-name">{review.label.text}</span>
						<ChevronDown aria-hidden className="composer-models-chevron" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" side="top" className="composer-models-menu">
					{ROLES.map((role) => (
						<RoleItem key={role} role={role} picker={pickers[role]} />
					))}
					<EffortItems picker={review} />
					{review.locked ? (
						<>
							<DropdownMenuSeparator />
							<p className="composer-models-note">Set by the admin.</p>
						</>
					) : null}
				</DropdownMenuContent>
			</DropdownMenu>
			{ROLES.map((role) => (
				<ModelDialog
					key={role}
					open={pickers[role].open}
					onOpenChange={pickers[role].setOpen}
					role={role}
					catalog={pickers[role].catalog}
					current={pickers[role].current}
					onPick={pickers[role].pickModel}
				/>
			))}
		</>
	);
}

/** One pick: its role, then the model it runs on; choosing it opens the model dialog. */
function RoleItem({ role, picker }: { role: ModelRole; picker: ModelPickerView }) {
	return (
		<DropdownMenuItem className="composer-models-role" disabled={!picker.canOpen} onSelect={() => picker.setOpen(true)}>
			<span className="composer-models-role-body">
				<span className="composer-models-role-name">{ROLE_NAME[role]}</span>
				<span className="composer-models-role-pick" data-quiet={picker.label?.quiet || undefined}>
					{picker.label?.text}
				</span>
				<ChevronRight aria-hidden className="composer-models-role-chevron" />
			</span>
		</DropdownMenuItem>
	);
}

/** The Review model's efforts, when it has a reasoning control: one is chosen, and a choice saves at once. */
function EffortItems({ picker }: { picker: ModelPickerView }) {
	if (!picker.effort || !picker.effortOptions) return null;

	const options = picker.effortOptions;

	/** Saves the effort the person chose, read back from the model's own options. */
	function choose(value: string): void {
		const option = options.find((candidate) => candidate.value === value);

		if (option) picker.chooseEffort(option.value);
	}

	return (
		<>
			<DropdownMenuSeparator />
			<p className="composer-models-label">Review effort</p>
			<DropdownMenuRadioGroup value={picker.effort} onValueChange={choose}>
				{options.map((option) => (
					<DropdownMenuRadioItem key={option.value} value={option.value} disabled={picker.locked}>
						{option.label}
					</DropdownMenuRadioItem>
				))}
			</DropdownMenuRadioGroup>
		</>
	);
}
