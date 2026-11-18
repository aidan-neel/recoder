import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { AgentMark } from '../../src/components/display/agent-mark';

describe('AgentMark', () => {
	test('keeps SVG mask, filter and gradient ids unique when the same mark renders twice', () => {
		const html = renderToStaticMarkup(
			<div>
				<AgentMark agent="antigravity" />
				<AgentMark agent="antigravity" />
				<AgentMark agent="codex" />
				<AgentMark agent="codex" />
			</div>
		);

		const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);

		expect(ids.length).toBeGreaterThan(2);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test('falls back to the terminal icon for custom commands', () => {
		const html = renderToStaticMarkup(<AgentMark agent="custom-command" />);

		expect(html).toContain('data-ui="agent-mark"');
		expect(html).not.toContain('data-agent=');
	});
});
