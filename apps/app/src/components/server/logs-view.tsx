'use client';

import type { LogLevel } from '@recoder/shared';
import { Button, SegmentedControl, Select } from '@recoder/ui';

import { useLogs, type LogFilter } from '@/lib/server/use-logs';

import { SectionNotice } from '@/components/settings/section-notice';
import { SettingsSkeleton } from '@/components/settings/settings-skeleton';

import { LogLines } from './log-lines';

const SOURCES = [
	{ value: 'all', label: 'All' },
	{ value: 'server', label: 'Server' },
	{ value: 'updater', label: 'Updater' },
	{ value: 'proxy', label: 'Proxy' }
];

const LEVEL_OPTIONS: { value: LogLevel; label: string }[] = [
	{ value: 'debug', label: 'Everything' },
	{ value: 'info', label: 'Info and up' },
	{ value: 'warn', label: 'Warnings and errors' },
	{ value: 'error', label: 'Errors' }
];

/** Settings → Server → Logs: what the server, its updater and its proxy wrote, newest first, as it is written. */
export function LogsView() {
	const view = useLogs();
	const { filter } = view;

	return (
		<div className="server-logs">
			<div className="server-logs-bar">
				<SegmentedControl
					aria-label="Source"
					value={filter.source}
					options={SOURCES}
					onValueChange={(source) =>
						view.setFilter({
							...filter,
							source: SOURCES.some((item) => item.value === source) ? (source as LogFilter['source']) : 'all'
						})
					}
				/>
				<Select
					aria-label="Level"
					value={filter.level}
					options={LEVEL_OPTIONS}
					onValueChange={(level) =>
						view.setFilter({ ...filter, level: LEVEL_OPTIONS.find((item) => item.value === level)?.value ?? 'info' })
					}
				/>
				<span className="server-logs-live" data-live={view.live || undefined}>
					{view.live ? 'Live' : 'Not live'}
				</span>
			</div>
			{view.lines ? <LogLines lines={view.lines} label="Server log" /> : null}
			{view.lines?.length === 0 ? <p className="server-logs-empty">Nothing logged at this level yet.</p> : null}
			{!view.lines && view.error ? (
				<SectionNotice
					what="The log"
					error={view.error}
					retry={{ status: 'idle', run: () => view.setFilter({ ...filter }) }}
				/>
			) : null}
			{!view.lines && !view.error ? <SettingsSkeleton groups={[8]} /> : null}
			{view.lines && view.older ? (
				<Button variant="ghost" onClick={view.older} status={view.olderStatus}>
					Show older lines
				</Button>
			) : null}
		</div>
	);
}
