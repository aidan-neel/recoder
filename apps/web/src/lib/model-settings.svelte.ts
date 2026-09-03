import type { ModelSettings, ModelSettingsPatch, ReviewRole } from '@recoder/shared';
import { serverApi } from './server-api';

export const MODEL_ROLES: ReviewRole[] = ['security', 'perf', 'correctness', 'docs'];

/** Global open state + cached config for the model settings modal. */
class ModelSettingsUi {
	open = $state(false);
	config = $state<ModelSettings | null>(null);
	loading = $state(false);
	saving = $state(false);
	error = $state<string | null>(null);

	show(): void {
		this.open = true;
		void this.load();
	}

	hide(): void {
		this.open = false;
	}

	async load(): Promise<void> {
		this.loading = true;
		this.error = null;
		try {
			this.config = await serverApi.getModelSettings();
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Failed to load model settings.';
		} finally {
			this.loading = false;
		}
	}

	async save(patch: ModelSettingsPatch): Promise<boolean> {
		this.saving = true;
		this.error = null;
		try {
			this.config = await serverApi.saveModelSettings(patch);
			return true;
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Failed to save model settings.';
			return false;
		} finally {
			this.saving = false;
		}
	}
}

export const modelSettingsUi = new ModelSettingsUi();
