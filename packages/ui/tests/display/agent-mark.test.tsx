import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { AgentMark } from '../../src/components/display/agent-mark';

const BRANDED_AGENTS = [
	'opencode',
	'claude-code',
	'devin',
	'codex',
	'pi',
	'grok',
	'cursor',
	'antigravity',
	'copilot'
] as const;

describe('AgentMark', () => {
	test('renders a brand SVG rather than the terminal fallback for every known agent', () => {
		for (const agent of BRANDED_AGENTS) {
			const html = renderToStaticMarkup(<AgentMark agent={agent} />);

			expect(html).toContain(`data-agent="${agent}"`);
			expect(html).not.toContain('lucide-square-terminal');
		}
	});

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

		expect(html).toContain('lucide-square-terminal');
	});
});
