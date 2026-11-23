'use client';

import type { PersonRef } from '@recoder/shared';
import { useMemo } from 'react';
import { useStore } from 'zustand';

import { useListStore } from '../api/client';
import { personRefOf } from './refs';

/** The person a login names in a tracked repository; null for a local repository or before the repositories load. */
export function usePersonRef(repoId: string, login: string): PersonRef | null {
	const list = useListStore();
	const repo = useStore(list.state, (state) => state.repos?.find((candidate) => candidate.id === repoId) ?? null);

	return useMemo(() => personRefOf(repo, login), [repo, login]);
}
