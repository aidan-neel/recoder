'use client';

import { REVIEW_SPEED_PLANS, REVIEW_SPEEDS, type ReviewSpeed } from '@recoder/shared';
import {
	AgentMark,
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
import { ChevronDown, ChevronRight, Zap } from 'lucide-react';

import { useApi } from '@/lib/api/client';
import type { ModelRole } from '@/lib/settings/model-options';
import { useModelPicker, type ModelPickerView } from '@/lib/settings/use-model-picker';

import { ModelDialog } from '@/components/settings/model-dialog';

/** The picks the composer offers: the model that runs reviews and chats, and the one its subagents run on. */
const ROLES = ['orchestrator', 'specialist'] as const satisfies readonly ModelRole[];

type ComposerRole = (typeof ROLES)[number];

/** What the menu calls each pick: the agent, since the menu already says it is a model. */
const ROLE_LABEL: Record<ComposerRole, string> = { orchestrator: 'Reviewer', specialist: 'Subagent' };

/** How fast the review the composer starts runs, for a composer that starts one (New, in Review mode). */
export interface SpeedChoice {
	speed: ReviewSpeed;
	onSpeedChange: (speed: ReviewSpeed) => void;
}

/**
 * The models every review and chat runs on, from the composer's bar: a quiet
 * trigger that names the Reviewer model, opening a menu with the Reviewer
 * and Subagent picks, the Reviewer's effort and, with `speed`, the speed of
 * the review it starts. A pick opens the same searchable dialog as Settings
 * and saves at once: to Settings for the admin, to the member's own account
 * for a member. While the admin sets a member's models, the menu shows them,
 * changes nothing and says why. The sample has no settings, so there the
 * menu holds only the speed, and nothing without one.
 */
export function ComposerModels({ speed }: { speed?: SpeedChoice }) {
	const sample = useApi().base !== '';

	if (!sample) return <ModelMenu speed={speed} />;

	return speed ? <SpeedMenu choice={speed} /> : null;
}

/** The menu and the dialogs it opens; with the models offline, the speed alone. */
function ModelMenu({ speed }: { speed?: SpeedChoice }) {
	const review = useModelPicker('orchestrator');
	const subagent = useModelPicker('specialist');
	const pickers: Record<ComposerRole, ModelPickerView> = { orchestrator: review, specialist: subagent };

	if (review.offline) return speed ? <SpeedMenu choice={speed} /> : null;
	if (!review.label) return <Skeleton className="composer-models-loading" />;

	const models = `${review.label.text} reviewer, ${subagent.label?.text ?? 'loading'} subagent`;

	return (
		<>
			<DropdownMenu>
				<MenuTrigger
					name={review.label.text}
					agent={review.pick?.option?.agent}
					label={speed ? `${models}, ${speedName(speed.speed)}` : `Models: ${models}`}
					spark={speed?.speed === 'spark'}
				/>
				<DropdownMenuContent align="end" side="top" className="composer-models-menu">
					{ROLES.map((role) => (
						<RoleItem key={role} role={role} picker={pickers[role]} />
					))}
					<EffortItems picker={review} />
					{speed ? (
						<>
							<DropdownMenuSeparator />
							<SpeedItems choice={speed} />
						</>
					) : null}
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

/** The speed alone, where there are no models to pick: a trigger that names it, over a menu of the speeds. */
function SpeedMenu({ choice }: { choice: SpeedChoice }) {
	const name = REVIEW_SPEED_PLANS[choice.speed].label;

	return (
		<DropdownMenu>
			<MenuTrigger name={name} label={`Review speed: ${name}`} spark={choice.speed === 'spark'} />
			<DropdownMenuContent align="end" side="top" className="composer-models-menu">
				<SpeedItems choice={choice} />
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

interface MenuTriggerProps {
	/** What the trigger shows: the Reviewer model, or the speed where there are no models. */
	name: string;
	/** The agent CLI serving the Reviewer model, whose mark leads the name; none for a plain endpoint or no model. */
	agent?: string;
	/** The trigger's whole name for a screen reader. */
	label: string;
	/** Spark is chosen: its mark follows the name. */
	spark: boolean;
}

/** The quiet trigger in the composer's bar. */
function MenuTrigger({ name, agent, label, spark }: MenuTriggerProps) {
	return (
		<DropdownMenuTrigger>
			<Button variant="quiet" className="composer-models" aria-label={label}>
				{agent ? <AgentMark agent={agent} className="composer-models-mark" /> : null}
				<span className="composer-models-name">{name}</span>
				{spark ? <Zap aria-hidden className="composer-models-spark" /> : null}
				<ChevronDown aria-hidden className="composer-models-chevron" />
			</Button>
		</DropdownMenuTrigger>
	);
}

/** A speed as a screen reader hears it after the models: "Spark review". */
function speedName(speed: ReviewSpeed): string {
	return `${REVIEW_SPEED_PLANS[speed].label} review`;
}

/** One pick: its role, then the model it runs on; choosing it opens the model dialog. */
function RoleItem({ role, picker }: { role: ComposerRole; picker: ModelPickerView }) {
	return (
		<DropdownMenuItem className="composer-models-role" disabled={!picker.canOpen} onSelect={() => picker.setOpen(true)}>
			<span className="composer-models-role-body">
				<span className="composer-models-role-name">{ROLE_LABEL[role]}</span>
				<span className="composer-models-role-pick" data-quiet={picker.label?.quiet || undefined}>
					{picker.label?.text}
				</span>
				<ChevronRight aria-hidden className="composer-models-role-chevron" />
			</span>
		</DropdownMenuItem>
	);
}

/** The Reviewer model's efforts, when it has a reasoning control: one is chosen, and a choice saves at once. */
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
			<p className="composer-models-label">Reviewer effort</p>
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

/** The speeds of the review the composer starts, each over what it trades; a choice holds for the visit. */
function SpeedItems({ choice }: { choice: SpeedChoice }) {
	/** Takes the speed the person chose, read back from the known ones. */
	function choose(value: string): void {
		const speed = REVIEW_SPEEDS.find((candidate) => candidate === value);

		if (speed) choice.onSpeedChange(speed);
	}

	return (
		<>
			<p className="composer-models-label">Speed</p>
			<DropdownMenuRadioGroup value={choice.speed} onValueChange={choose}>
				{REVIEW_SPEEDS.map((speed) => (
					<DropdownMenuRadioItem key={speed} value={speed} className="composer-speed">
						<span className="composer-speed-body">
							{REVIEW_SPEED_PLANS[speed].label}
							<span className="composer-speed-detail">{REVIEW_SPEED_PLANS[speed].description}</span>
						</span>
					</DropdownMenuRadioItem>
				))}
			</DropdownMenuRadioGroup>
		</>
	);
}
