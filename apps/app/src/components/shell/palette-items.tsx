'use client';

import { Spinner } from '@recoder/ui';
import {
	Bot,
	Gauge,
	GitPullRequest,
	Inbox,
	Keyboard,
	MessageSquareText,
	Palette,
	Plug,
	ScrollText,
	Sparkles,
	SunMoon,
	X,
	type LucideIcon
} from 'lucide-react';

import { requestAskFocus } from '@/lib/ask/focus-request';
import { useReview } from '@/lib/review/review-store';
import { SETTINGS_SECTIONS, type SettingsSection } from '@/lib/settings/sections';
import { pullRef } from '@/lib/shell/format';
import { QUEUE_TAB } from '@/lib/shell/routes';
import { useShell, type PaletteItem, type ReviewTab } from '@/lib/shell/shell-store';
import { useTheme } from '@/lib/shell/theme';

import { tabName } from './tab-label';

/** Each settings section's icon in the palette. */
const SECTION_ICONS: Record<SettingsSection, LucideIcon> = {
	agent: Bot,
	connections: Plug,
	harness: Gauge,
	guidelines: ScrollText,
	appearance: Palette
};

/** Words a person might type for each settings section besides its name. */
const SECTION_WORDS: Record<SettingsSection, string> = {
	agent: 'model provider effort reviewer',
	connections: 'github gitlab forge token repositories',
	harness: 'limits budget concurrency verification',
	guidelines: 'rules conventions standards',
	appearance: 'theme dark light'
};

/** A running review's mark in the palette: the spinner the tab shows. */
export function RunningIcon({ className }: { className?: string }) {
	return <Spinner className={className} />;
}

/** The open review tabs, except the one on screen, as palette rows; `open` goes to a tab. */
export function tabItems(tabs: ReviewTab[], active: string | null, open: (id: string) => void): PaletteItem[] {
	return tabs
		.filter((tab) => tab.id !== active)
		.map((tab) => ({
			id: `tab:${tab.id}`,
			group: 'Open tabs',
			label: tabName(tab),
			detail: pullRef(tab.repo, tab.pr),
			keywords: `${tab.repo} ${tab.pr}`,
			icon: tab.open === null ? RunningIcon : GitPullRequest,
			tone: tab.open === null ? 'var(--sev-medium)' : 'var(--ok)',
			run: () => open(tab.id)
		}));
}

/** Closing the review on screen, from the keyboard: the tab's X and menu want a pointer or a menu key. */
function closeItem(closeTab: (() => void) | null): PaletteItem[] {
	if (!closeTab) return [];

	return [
		{ id: 'close-tab', group: 'Actions', label: 'Close this tab', keywords: 'close tab review', icon: X, run: closeTab }
	];
}

/**
 * Opens the review's conversation with Orchestrator: the overview, with the
 * ask column open on it and focus in its message field, even when the column
 * was open already.
 */
function askOrchestrator(): void {
	const { select, setAskOpen } = useReview.getState();

	select({ kind: 'overview' });
	setAskOpen(true);
	requestAskFocus();
}

/** The review page's own action: talk to Orchestrator, which q also opens from the overview. */
function askItem(askable: boolean): PaletteItem[] {
	if (!askable) return [];

	return [
		{
			id: 'ask-orchestrator',
			group: 'Actions',
			label: 'Ask Orchestrator',
			keywords: 'chat conversation question talk',
			icon: MessageSquareText,
			shortcut: 'q',
			run: askOrchestrator
		}
	];
}

/**
 * The palette's own rows, after the page's and the open tabs: places to go and
 * app-wide actions. `open` goes to a tab, so the bar's pill heads there at
 * once; `closeTab` closes the review on screen, when one is; `askable` adds
 * Ask Orchestrator on a review that has one (not the sample).
 */
export function actionItems(
	open: (id: string) => void,
	closeTab: (() => void) | null,
	askable: boolean
): PaletteItem[] {
	const go = (href: string) => useShell.getState().navigate(href);

	const settings = SETTINGS_SECTIONS.map((section): PaletteItem => ({
		id: `settings:${section.id}`,
		group: 'Actions',
		label: `${section.label} settings`,
		keywords: `settings preferences ${SECTION_WORDS[section.id]}`,
		icon: SECTION_ICONS[section.id],
		shortcut: section.id === 'agent' ? 'mod+,' : undefined,
		run: () => go(`/settings/${section.id}`)
	}));

	return [
		...askItem(askable),
		{
			id: 'go-queue',
			group: 'Actions',
			label: 'Go to the queue',
			keywords: 'home inbox pull requests',
			icon: Inbox,
			run: () => open(QUEUE_TAB)
		},
		{
			id: 'go-sample',
			group: 'Actions',
			label: 'Open the sample review',
			keywords: 'demo example tour',
			icon: Sparkles,
			run: () => open('sample')
		},
		...closeItem(closeTab),
		...settings,
		{
			id: 'shortcuts',
			group: 'Actions',
			label: 'Keyboard shortcuts',
			keywords: 'keys hotkeys help',
			shortcut: '?',
			icon: Keyboard,
			run: () => useShell.getState().setShortcutsOpen(true)
		},
		{
			id: 'theme',
			group: 'Actions',
			label: 'Switch between light and dark',
			keywords: 'dark light appearance theme mode',
			icon: SunMoon,
			run: () => useTheme.getState().toggle()
		}
	];
}
