'use client';

import type { ReviewToolCall } from '@recoder/shared';
import { createContext, useContext } from 'react';

import type { StudioAgent, StudioView } from '@/lib/studio/studio-view';

/** What every part of Studio shares: the view, the cast by id, the stream's calls, and the agent a person picked. */
export interface Scene {
	view: StudioView;
	agents: Map<string, StudioAgent>;
	calls: ReviewToolCall[];
	startedAt: string | null;
	selected: string | null;
	select: (id: string | null) => void;
}

export const SceneContext = createContext<Scene | null>(null);

export function useScene(): Scene {
	const scene = useContext(SceneContext);

	if (!scene) throw new Error('Studio parts render inside a Studio.');

	return scene;
}
