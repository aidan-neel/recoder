'use client';

import type { LogLevel, LogLine, LogSource } from '@recoder/shared';
import { useEffect, useState } from 'react';

import { failureText } from '../api/http';
import { serverApi } from '../api/server';
import { useAction } from '../shell/use-action';

/** The most lines the page holds; older ones fall off the end as new ones stream in. */
const MAX_LINES = 2000;

/** Each level and the ones above it, so a filter on `warn` keeps errors too. */
const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

/** Which lines the page shows: every source or one, every level or one and above. */
export interface LogFilter {
	source: LogSource | 'all';
	level: LogLevel;
}

/** Everything Settings → Server → Logs shows and does. */
export interface LogsView {
	/** Newest first; null until the first page loads. */
	lines: LogLine[] | null;
	error: string | null;
	filter: LogFilter;
	setFilter: (filter: LogFilter) => void;
	/** True while new lines stream in. */
	live: boolean;
	/** Reads the page before the oldest line shown; null once the server has nothing older. */
	older: (() => void) | null;
	olderStatus: ReturnType<typeof useAction>['status'];
}

/** True when `line` passes `filter`. */
function shows(line: LogLine, filter: LogFilter): boolean {
	return (
		(filter.source === 'all' || line.source === filter.source) &&
		LEVELS.indexOf(line.level) >= LEVELS.indexOf(filter.level)
	);
}

/** The server's query for `filter`: a level of debug and every source ask for everything. */
function queryOf(filter: LogFilter) {
	return {
		source: filter.source === 'all' ? undefined : filter.source,
		level: filter.level === 'debug' ? undefined : filter.level
	};
}

/**
 * The server's recent log, newest first, then new lines as they are written, for as long as the view is open. A
 * change of filter reads the first page again.
 */
export function useLogs(): LogsView {
	const [filter, setFilter] = useState<LogFilter>({ source: 'all', level: 'info' });
	const [lines, setLines] = useState<LogLine[] | null>(null);
	const [before, setBefore] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [live, setLive] = useState(false);
	const loading = useAction();

	useEffect(() => {
		let open = true;

		serverApi.logs(queryOf(filter)).then(
			(page) => {
				if (!open) return;

				setLines(page.lines);
				setBefore(page.before);
				setError(null);
			},
			(failure: unknown) => {
				if (open) setError(failureText(failure, 'The log did not load.'));
			}
		);

		const events = new EventSource(serverApi.logEventsUrl(), { withCredentials: true });

		events.addEventListener('open', () => setLive(true));
		events.addEventListener('error', () => setLive(false));

		events.addEventListener('line', (event) => {
			const line = JSON.parse((event as MessageEvent<string>).data) as LogLine;

			if (shows(line, filter)) setLines((shown) => (shown ? [line, ...shown].slice(0, MAX_LINES) : shown));
		});

		return () => {
			open = false;
			events.close();
			setLive(false);
		};
	}, [filter]);

	return {
		lines,
		error,
		filter,
		setFilter: (next) => {
			setLines(null);
			setFilter(next);
		},
		live,
		older:
			before === null
				? null
				: () =>
						loading.run(async () => {
							const page = await serverApi.logs({ ...queryOf(filter), before });

							setLines((shown) => [...(shown ?? []), ...page.lines]);
							setBefore(page.before);
						}),
		olderStatus: loading.status
	};
}
