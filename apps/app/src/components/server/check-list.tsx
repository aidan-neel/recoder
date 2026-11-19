'use client';

import { StatusGlyph } from '@recoder/ui';

import { CHECK_LABELS, checkGlyph } from '@/lib/server/checks';
import type { ChecksView } from '@/lib/server/use-checks';

/** The server's checks, one line each: its glyph, its name, what was found, and what to do when it is not right. */
export function CheckList({ view }: { view: ChecksView }) {
	if (view.error)
		return (
			<p className="server-check-error" role="alert">
				{view.error}
			</p>
		);

	if (!view.checks) {
		return (
			<ul className="server-checks" aria-busy="true">
				{Object.values(CHECK_LABELS).map((label) => (
					<li key={label} className="server-check">
						<StatusGlyph kind="spinner" label="Checking" />
						<span className="server-check-name">{label}</span>
					</li>
				))}
			</ul>
		);
	}

	return (
		<ul className="server-checks">
			{view.checks.checks.map((check) => (
				<li key={check.id} className="server-check" data-state={check.state}>
					<StatusGlyph kind={checkGlyph(check)} label={check.state} />
					<span className="server-check-name">{CHECK_LABELS[check.id]}</span>
					<span className="server-check-text">
						<span className="server-check-detail">{check.detail}</span>
						{check.fix && (check.state === 'warn' || check.state === 'fail') ? (
							<span className="server-check-fix">{check.fix}</span>
						) : null}
					</span>
				</li>
			))}
		</ul>
	);
}
