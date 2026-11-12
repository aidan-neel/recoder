'use client';

import { Button } from '@recoder/ui/button';
import { StatusNotice } from '@recoder/ui/status-notice';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface PanelBoundaryProps {
	/** What the panel is, for the notice: "The rail", "The reading pane". */
	name: string;
	/** On the element that stands in for the panel, so the page keeps its layout. */
	className: string;
	/** A change of this value (the selection, for the reading pane) clears an error, so moving on renders again. */
	resetKey?: string;
	children: ReactNode;
}

interface PanelBoundaryState {
	failed: boolean;
	resetKey: string | undefined;
}

/**
 * Keeps a render error inside one panel of the review page: the panel shows
 * what broke and Try again, and the rest of the page keeps working. Without
 * it, an error anywhere would blank the whole page.
 */
export class PanelBoundary extends Component<PanelBoundaryProps, PanelBoundaryState> {
	override state: PanelBoundaryState = { failed: false, resetKey: this.props.resetKey };

	static getDerivedStateFromError(): Partial<PanelBoundaryState> {
		return { failed: true };
	}

	static getDerivedStateFromProps(
		props: PanelBoundaryProps,
		state: PanelBoundaryState
	): Partial<PanelBoundaryState> | null {
		if (props.resetKey === state.resetKey) return null;

		return { failed: false, resetKey: props.resetKey };
	}

	override componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error(error, info.componentStack);
	}

	override render(): ReactNode {
		if (!this.state.failed) return this.props.children;

		return (
			<div data-ui="panel-failed" className={this.props.className}>
				<StatusNotice
					tone="danger"
					title={`${this.props.name} hit an error.`}
					detail="If it keeps happening, reload the page."
					actions={<Button onClick={() => this.setState({ failed: false })}>Try again</Button>}
				/>
			</div>
		);
	}
}
