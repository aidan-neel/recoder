'use client';

import { Button, Card, Composer, Field, Icon, Input, Pill, StatusNotice } from '@recoder/ui';
import { useRef, useState } from 'react';

import { Crumbs } from '@/components/common/crumbs';
import { FindField } from '@/components/common/find-field';
import { Link } from '@/components/common/link';
import { Page } from '@/components/common/page';
import {
	EXAMPLE_PULL_LINK,
	LAB_EXAMPLES,
	labPullLabel,
	matchLabBrief,
	resolveLabLink,
	type LabPull
} from '@/lib/compose/compose-lab';
import { useComposeLabRun, type ComposeLabRun } from '@/lib/compose/use-compose-lab-run';
import { composeLabHref, type ComposeLabVariant } from '@/lib/shell/routes';

const VARIANTS = [
	{ id: 'a', name: 'Link first', short: 'Link', title: 'Paste a pull request link', View: LinkFirst },
	{ id: 'b', name: 'Brief first', short: 'Brief', title: 'Describe the change', View: BriefFirst },
	{ id: 'c', name: 'Recent changes', short: 'Recent', title: 'Start from recent changes', View: RecentChanges }
] as const;

export function ComposeLabScreen({ variant }: { variant: ComposeLabVariant }) {
	const { title, View } = VARIANTS.find(({ id }) => id === variant) ?? VARIANTS[0];

	return (
		<Page
			start={<Crumbs parts={[{ label: 'Composer lab' }]} />}
			end={
				<nav className="compose-lab-nav" aria-label="Composer variants">
					{VARIANTS.map(({ id, name, short }) => (
						<Button key={id} asChild variant="ghost">
							<Link href={composeLabHref(id)} aria-current={id === variant ? 'page' : undefined} aria-label={name}>
								<span className="compose-lab-letter">{id.toUpperCase()}</span>
								<span className="compose-lab-nav-name">{name}</span>
								<span className="compose-lab-nav-short">{short}</span>
							</Link>
						</Button>
					))}
				</nav>
			}
		>
			<div className="compose-lab-scroll">
				<section className="compose-lab" data-variant={variant} aria-labelledby="compose-lab-title">
					<h1 id="compose-lab-title">{title}</h1>
					<View />
				</section>
			</div>
		</Page>
	);
}

function RunButton({ run, ready }: { run: ComposeLabRun; ready: boolean }) {
	return (
		<Button
			variant="primary"
			status={run.phase}
			disabled={!ready}
			aria-disabled={run.phase === 'success' || undefined}
			onClick={run.simulate}
		>
			Simulate review
		</Button>
	);
}

function RunNote({ run }: { run: ComposeLabRun }) {
	return (
		<p className="compose-lab-run-note" role="status">
			{run.phase === 'success' ? (
				<>
					<Icon name="check_circle" />
					Simulation complete. No review was started.
				</>
			) : (
				'Sample only. No review is sent.'
			)}
		</p>
	);
}

function OptionalBrief({
	run,
	pull,
	showTarget
}: {
	run: ComposeLabRun;
	pull: LabPull | undefined;
	showTarget?: boolean;
}) {
	const [brief, setBrief] = useState('');

	return (
		<div className="compose-lab-brief">
			<p className="compose-lab-label">
				Review brief <span>· Optional</span>
			</p>
			<Composer
				label="Optional review brief"
				minRows={3}
				maxRows={6}
				placeholder="What should the review look at?"
				value={brief}
				onValueChange={(value) => {
					run.reset();
					setBrief(value);
				}}
				onSubmit={() => pull && run.simulate()}
				targets={
					showTarget ? (
						<span className="compose-lab-dock-target" role="status">
							<Icon name="pull_request" />
							{pull ? labPullLabel(pull) : 'No pull request selected'}
						</span>
					) : undefined
				}
				action={<RunButton ready={Boolean(pull)} run={run} />}
			/>
			<RunNote run={run} />
		</div>
	);
}

function LinkFirst() {
	const [value, setValue] = useState('');
	const [result, setResult] = useState<ReturnType<typeof resolveLabLink>>();
	const input = useRef<HTMLInputElement>(null);
	const run = useComposeLabRun();
	const pull = result?.pull;

	function edit(next: string) {
		setValue(next);
		setResult(undefined);
		run.reset();
	}

	return (
		<>
			<form
				onSubmit={(event) => {
					event.preventDefault();

					if (value.trim()) setResult(resolveLabLink(value));
				}}
			>
				<Field label="Pull request link">
					<div className="compose-lab-link-line">
						<Input
							ref={input}
							autoComplete="off"
							spellCheck={false}
							leading={<Icon name="link" />}
							value={value}
							invalid={Boolean(result?.error)}
							onChange={(event) => edit(event.target.value)}
							placeholder="https://github.com/owner/project/pull/123"
						/>
						<Button type="submit" disabled={!value.trim()}>
							Find pull request
						</Button>
					</div>
				</Field>
			</form>
			<Card className="compose-lab-receipt">
				<span className="sr-only" role="status">
					{pull ? `Matched ${pull.title}, ${labPullLabel(pull)}.` : ''}
				</span>
				{pull ? (
					<div className="compose-lab-receipt-body">
						<Icon name="pull_request" />
						<div className="compose-lab-target-copy">
							<p>{pull.title}</p>
							<p className="compose-lab-meta">
								{labPullLabel(pull)}
								<span> · </span>
								{pull.headRef} → {pull.base}
							</p>
						</div>
						<Pill tone="ok" icon={<Icon name="check" />}>
							Matched
						</Pill>
					</div>
				) : (
					<div className="compose-lab-receipt-body">
						{result?.error ? (
							<StatusNotice variant="inline" tone="danger" title={result.error} />
						) : (
							<div className="compose-lab-target-copy">
								<p>No pull request yet</p>
								<p className="compose-lab-muted">The link determines which change to review.</p>
							</div>
						)}
						<Button
							variant="ghost"
							onClick={() => {
								edit(EXAMPLE_PULL_LINK);
								input.current?.focus();
							}}
						>
							Use example link
						</Button>
					</div>
				)}
			</Card>
			<OptionalBrief run={run} pull={pull} />
		</>
	);
}

function BriefFirst() {
	const [brief, setBrief] = useState('');
	const [matches, setMatches] = useState<ReturnType<typeof matchLabBrief>>();
	const [choice, setChoice] = useState<LabPull>();
	const panelTitle = useRef<HTMLHeadingElement>(null);
	const run = useComposeLabRun();
	const match = matches?.find(({ pull }) => pull === choice) ?? (matches?.length === 1 ? matches[0] : undefined);

	function edit(text: string) {
		setBrief(text);
		setMatches(undefined);
		setChoice(undefined);
		run.reset();
	}

	function findMatch() {
		if (brief.trim()) setMatches(matchLabBrief(brief));
	}

	return (
		<div className="compose-lab-brief-grid">
			<div className="compose-lab-brief">
				<p className="compose-lab-label">Review brief</p>
				<Composer
					size="lg"
					minRows={5}
					maxRows={9}
					label="Review brief"
					placeholder="Name the change and what you’d like checked."
					value={brief}
					onValueChange={edit}
					onSubmit={findMatch}
					action={
						<Button disabled={!brief.trim()} onClick={findMatch}>
							Find a match
						</Button>
					}
				/>
				<div className="compose-lab-examples" aria-label="Example briefs" role="group">
					{LAB_EXAMPLES.map(({ label, brief }) => (
						<Button key={label} variant="outline" aria-label={`Use example: ${label}`} onClick={() => edit(brief)}>
							{label}
						</Button>
					))}
				</div>
			</div>
			<Card as="section" className="compose-lab-match" aria-labelledby="compose-lab-match-title">
				<h2 id="compose-lab-match-title" ref={panelTitle} tabIndex={-1}>
					Matched change
				</h2>
				<span className="sr-only" role="status">
					{match
						? `Matched ${match.pull.title}, ${labPullLabel(match.pull)}.`
						: matches && matches.length > 1
							? 'More than one change matches. Which one did you mean?'
							: ''}
				</span>
				{match ? (
					<div className="compose-lab-target-copy">
						<p>{match.pull.title}</p>
						<p className="compose-lab-meta">{labPullLabel(match.pull)}</p>
						<p className="compose-lab-muted">Matched “{match.term}” in your brief.</p>
					</div>
				) : matches && matches.length > 1 ? (
					<div className="compose-lab-candidates">
						<p>More than one change matches. Which one did you mean?</p>
						{matches.map(({ pull }) => (
							<Button
								key={pull.url}
								variant="outline"
								onClick={() => {
									panelTitle.current?.focus();
									setChoice(pull);
								}}
							>
								{pull.title}
							</Button>
						))}
					</div>
				) : matches ? (
					<StatusNotice variant="inline" tone="danger" title="No match. Name the change or try an example." />
				) : (
					<div className="compose-lab-target-copy">
						<p>No match yet</p>
						<p className="compose-lab-muted">We’ll look for an open pull request that fits your brief.</p>
					</div>
				)}
				<div className="compose-lab-match-action">
					<RunButton ready={Boolean(match)} run={run} />
					<RunNote run={run} />
				</div>
			</Card>
		</div>
	);
}

function RecentChanges() {
	const [query, setQuery] = useState('');
	const [picked, setPicked] = useState<LabPull>();
	const run = useComposeLabRun();
	const filtered = LAB_EXAMPLES.filter(({ pull }) => pull.title.toLowerCase().includes(query.trim().toLowerCase()));

	return (
		<>
			<div className="compose-lab-recent">
				<div className="compose-lab-recent-head">
					<FindField
						label="Search recent changes"
						placeholder="Search recent changes"
						query={query}
						onQueryChange={setQuery}
					/>
					<p className="compose-lab-meta" role="status">
						{filtered.length} {filtered.length === 1 ? 'open pull request' : 'open pull requests'}
					</p>
				</div>
				<ul className="compose-lab-activity" aria-label="Recent pull requests">
					{filtered.map(({ pull, age }) => (
						<li key={pull.url}>
							<Button
								variant="quiet"
								className="compose-lab-activity-button"
								aria-label={`${pull.title}, ${labPullLabel(pull)}, updated ${age}`}
								aria-pressed={picked === pull}
								onClick={() => {
									if (picked !== pull) run.reset();

									setPicked(pull);
								}}
							>
								<Icon name={picked === pull ? 'check_circle' : 'pull_request'} />
								<span className="compose-lab-target-copy">
									<span>{pull.title}</span>
									<span className="compose-lab-meta">{labPullLabel(pull)}</span>
								</span>
								<span className="compose-lab-age">{age}</span>
							</Button>
						</li>
					))}
					{filtered.length === 0 ? (
						<li>
							<StatusNotice title="No changes match this search" detail="Try part of a pull request title." />
						</li>
					) : null}
				</ul>
			</div>
			<OptionalBrief run={run} pull={picked} showTarget />
		</>
	);
}
