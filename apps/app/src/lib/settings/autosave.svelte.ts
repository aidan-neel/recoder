import { modelSettingsUi } from '$web/settings/model-settings.svelte';
import { settingsDraft } from '$web/settings/settings-draft.svelte';

/** Edits wait this long for the next one, so a run of clicks saves once. */
const DEBOUNCE_MS = 400;

/** How long "Saved" holds before the status goes quiet. */
const SAVED_MS = 1600;

type Status = 'idle' | 'saving' | 'saved' | 'failed';

/**
 * Saves settings edits as they are made, the way the modal has no Save
 * button. One save runs at a time; edits made while it is in flight stay
 * pending and go in the next one.
 */
class AutoSave {
	status = $state<Status>('idle');
	error = $state<string | null>(null);

	private timer: ReturnType<typeof setTimeout> | undefined;
	private quiet: ReturnType<typeof setTimeout> | undefined;

	/** Edits are waiting to be saved. */
	get dirty(): boolean {
		return settingsDraft.seeded && Object.keys(settingsDraft.patch()).length > 0;
	}

	schedule(): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.save(), DEBOUNCE_MS);
	}

	/** Save what is pending now; resolves false when it could not be saved. */
	async save(): Promise<boolean> {
		clearTimeout(this.timer);
		if (modelSettingsUi.saving) return true;

		const patch = settingsDraft.patch();

		if (Object.keys(patch).length === 0) return true;

		const sent = settingsDraft.snapshot();

		clearTimeout(this.quiet);
		this.status = 'saving';
		this.error = null;

		if (!(await modelSettingsUi.save(patch))) {
			this.status = 'failed';
			this.error = modelSettingsUi.error ?? 'Settings were not saved.';

			return false;
		}

		settingsDraft.saved(sent);
		if (this.dirty) return this.save();

		this.status = 'saved';
		this.quiet = setTimeout(() => (this.status = 'idle'), SAVED_MS);

		return true;
	}
}

export const autosave = new AutoSave();
