'use client';

import type { Repo } from '@recoder/shared';
import { useStore } from 'zustand';

import { useListStore } from '../api/client';

/** The tracked repository with this id, or null until the list loads or when it is not tracked. */
export function useRepo(repoId: string): Repo | null {
	const list = useListStore();

	return useStore(list.state, (data) => data.repos?.find((repo) => repo.id === repoId) ?? null);
}
