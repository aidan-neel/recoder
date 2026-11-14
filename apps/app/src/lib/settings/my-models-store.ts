import type { MyModels, MyModelsPatch } from '@recoder/shared';
import { create } from 'zustand';

import { failureText } from '../api/http';
import { settingsApi } from '../api/settings';
import { errorToast } from '../shell/notify';

/** `failed`: the server answered with an error or not at all, so the person's own picks are unknown. */
type MyModelsStatus = 'idle' | 'ready' | 'failed';

interface MyModelsStore {
	status: MyModelsStatus;
	/** The models that apply to the person signed in; null until loaded. */
	mine: MyModels | null;
	/** Reads the picks once. A failure toasts and leaves the status `failed`. */
	load: () => Promise<void>;
	/** Saves the person's own picks and keeps the server's answer. Rejects on failure, including while the admin enforces models. */
	save: (patch: MyModelsPatch) => Promise<void>;
}

/** The models a member's reviews and chats run on: their own picks, or the admin's while enforced. */
export const useMyModels = create<MyModelsStore>((set, get) => ({
	status: 'idle',
	mine: null,

	async load() {
		if (get().status === 'ready') return;

		try {
			set({ mine: await settingsApi.myModels(), status: 'ready' });
		} catch (error) {
			set({ status: 'failed' });
			errorToast('Your models didn’t load', failureText(error));
		}
	},

	async save(changes) {
		set({ mine: await settingsApi.saveMyModels(changes), status: 'ready' });
	}
}));
