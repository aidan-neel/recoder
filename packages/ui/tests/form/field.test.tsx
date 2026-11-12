import { describe, expect, test } from 'bun:test';
import type { MouseEvent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Field, focusFieldControl } from '../../src/components/form/field';
import { Input } from '../../src/components/form/input';
import { LinkField } from '../../src/components/form/link-field';

/** No-op change handler for static markup rendering. */
function ignoreChange(): void {}

/** Minimal label click event stub so `focusFieldControl` can run without a browser DOM. */
function labelClickEvent(options: {
	hasNativeControl?: boolean;
	disabled?: boolean;
	byId?: boolean;
	labelledBy?: string;
	onFocus: () => void;
}): MouseEvent<HTMLLabelElement> {
	const element = {
		getAttribute: (name: string) => {
			if (name === 'aria-disabled') return options.disabled ? 'true' : null;
			if (name === 'aria-labelledby') return options.labelledBy ?? null;

			return null;
		},
		focus: options.onFocus
	};

	/** Stubbed `MouseEvent<HTMLLabelElement>` exposing only the label/document members `focusFieldControl` reads. */
	return {
		defaultPrevented: false,
		target: null,
		currentTarget: {
			control: options.hasNativeControl ? ({} as HTMLElement) : null,
			ownerDocument: {
				getElementById: () => (options.byId === false ? null : element)
			},
			parentElement: {
				querySelectorAll: () => (options.labelledBy ? [element] : [])
			}
		}
	} as unknown as MouseEvent<HTMLLabelElement>;
}

describe('Field', () => {
	test('wires its label id, control id and message id onto LinkField unless LinkField names itself', () => {
		const wired = renderToStaticMarkup(
			<Field label="Release notes" htmlFor="notes" hint="Paste pull request links">
				<LinkField value="" onValueChange={ignoreChange} />
			</Field>
		);

		expect(wired).toContain('id="notes-label"');
		expect(wired).toContain('for="notes"');
		expect(wired).toContain('role="textbox"');
		expect(wired).toContain('id="notes"');
		expect(wired).toContain('aria-labelledby="notes-label"');
		expect(wired).toContain('aria-describedby="notes-message"');

		const selfNamed = renderToStaticMarkup(
			<Field label="Release notes" htmlFor="notes">
				<LinkField value="" onValueChange={ignoreChange} aria-label="Custom name" />
			</Field>
		);

		expect(selfNamed).toContain('aria-label="Custom name"');
		expect(selfNamed).not.toContain('aria-labelledby=');
	});

	test('keeps native control wiring on Input inside Field', () => {
		const markup = renderToStaticMarkup(
			<Field label="Repository" htmlFor="repo" error="Repository is required">
				<Input defaultValue="" />
			</Field>
		);

		expect(markup).toContain('<input');
		expect(markup).toContain('id="repo"');
		expect(markup).toContain('aria-invalid="true"');
		expect(markup).toContain('aria-describedby="repo-message"');
	});

	test('focuses a non-labelable control on label click only when enabled and not natively associated', () => {
		let focused = 0;

		focusFieldControl(
			labelClickEvent({
				onFocus: () => {
					focused += 1;
				}
			}),
			'notes',
			'notes-label'
		);

		expect(focused).toBe(1);

		focusFieldControl(
			labelClickEvent({
				byId: false,
				labelledBy: 'other notes-label',
				onFocus: () => {
					focused += 1;
				}
			}),
			'notes',
			'notes-label'
		);

		expect(focused).toBe(2);

		focusFieldControl(
			labelClickEvent({
				disabled: true,
				onFocus: () => {
					focused += 1;
				}
			}),
			'notes',
			'notes-label'
		);

		focusFieldControl(
			labelClickEvent({
				hasNativeControl: true,
				onFocus: () => {
					focused += 1;
				}
			}),
			'notes',
			'notes-label'
		);

		expect(focused).toBe(2);
	});
});
