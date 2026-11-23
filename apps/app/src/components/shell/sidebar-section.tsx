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
import {
	ArrowsInLineVerticalIcon,
	ArrowsOutLineVerticalIcon,
	DotsThreeIcon,
	EyeSlashIcon,
	PlusIcon
} from '@phosphor-icons/react';
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
 * A sidebar group under its title, drawn as Capy draws its groups: the title in the body's ink at the title size, and
 * at its right the group's quiet + (what it starts) and ⋯ (its menu), shown at rest. A group with a ⋯ folds only from
 * that menu, so a click that lands on its title by mistake changes nothing; a group without one (Settled) folds from
 * its title.
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
				{onHide ? (
					<div className="section-head">
						<span className="section-title">{title}</span>
						{aside}
					</div>
				) : (
					<RowButton asChild className="section-head">
						<CollapsibleTrigger>
							<span className="section-title">{title}</span>
							{aside}
						</CollapsibleTrigger>
					</RowButton>
				)}
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
									<DropdownMenuItem
										icon={open ? <ArrowsInLineVerticalIcon /> : <ArrowsOutLineVerticalIcon />}
										onSelect={() => onOpenChange(!open)}
									>
										{open ? 'Collapse' : 'Expand'} {title}
									</DropdownMenuItem>
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
