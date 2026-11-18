'use client';

import { Input, Keycap } from '@recoder/ui';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useRef, type KeyboardEvent } from 'react';

import { useKeys } from '@/lib/shell/use-keys';

interface FindFieldProps {
	query: string;
	onQueryChange: (query: string) => void;
	/** What a screen reader calls the field. */
	label: string;
	placeholder: string;
	/** What Enter does with the text, on a page where it does something. */
	onSubmit?: () => void;
	className?: string;
}

/** The field in a page's bar that narrows what the page lists as you type. `/` focuses it, and Escape clears it. */
export function FindField({ query, onQueryChange, label, placeholder, onSubmit, className }: FindFieldProps) {
	const field = useRef<HTMLInputElement | null>(null);

	useKeys({ '/': () => field.current?.focus() });

	/** Enter hands the text to the page; Escape clears the text first, then leaves the field. */
	function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
		if (event.key === 'Enter') onSubmit?.();

		if (event.key === 'Escape' && query) {
			event.stopPropagation();
			onQueryChange('');
		}
	}

	return (
		<Input
			ref={field}
			className={className}
			type="search"
			aria-label={label}
			placeholder={placeholder}
			autoComplete="off"
			spellCheck={false}
			leading={<MagnifyingGlassIcon aria-hidden />}
			trailing={query ? undefined : <Keycap k="/" />}
			value={query}
			onChange={(event) => onQueryChange(event.target.value)}
			onKeyDown={onKeyDown}
		/>
	);
}
