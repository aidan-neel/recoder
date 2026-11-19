'use client';

import {
	Button,
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	RowButton,
	Tooltip
} from '@recoder/ui';
import { CaretDownIcon, DotsThreeIcon, EyeSlashIcon, PlusIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

interface SidebarSectionProps {
	title: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	className: string;
	/** Beside the title, such as a count. */
	aside?: ReactNode;
	/** The section's + button: what it starts, as its tooltip names it, and how. */
	add?: { label: string; onSelect: () => void };
	/** Takes the section out of the sidebar; its ⋯ menu offers it. */
	onHide?: () => void;
	children: ReactNode;
}

/**
 * A sidebar list under a title that folds it away: a click on the title opens or closes it. A section that starts
 * things has a + at the right of its title, and one the person can hide has a ⋯ menu beside it; both wait until
 * the title is pointed at or focused.
 */
export function SidebarSection({
	title,
	open,
	onOpenChange,
	className,
	aside,
	add,
	onHide,
	children
}: SidebarSectionProps) {
	return (
		<Collapsible open={open} onOpenChange={onOpenChange} className={className}>
			<div className="section-row">
				<RowButton asChild className="section-head">
					<CollapsibleTrigger>
						<span className="section-label">{title}</span>
						{aside}
						<CaretDownIcon aria-hidden className="section-chevron" />
					</CollapsibleTrigger>
				</RowButton>
				{add || onHide ? (
					<div className="section-tools">
						{add ? (
							<Tooltip content={add.label}>
								<Button variant="ghost" size="icon" aria-label={add.label} onClick={add.onSelect}>
									<PlusIcon />
								</Button>
							</Tooltip>
						) : null}
						{onHide ? (
							<DropdownMenu>
								<DropdownMenuTrigger>
									<Button variant="ghost" size="icon" aria-label={`More for ${title}`}>
										<DotsThreeIcon />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="start" className="w-[200px]">
									<DropdownMenuItem icon={<EyeSlashIcon />} onSelect={onHide}>
										Hide {title}
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						) : null}
					</div>
				) : null}
			</div>
			<CollapsibleContent>{children}</CollapsibleContent>
		</Collapsible>
	);
}
