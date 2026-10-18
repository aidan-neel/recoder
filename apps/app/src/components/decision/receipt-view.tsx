'use client';

import { Markdown, Pill } from '@recoder/ui';

import { plain } from '@/lib/review/labels';
import { surfaceOf, useReview } from '@/lib/review/review-store';
import type { Receipt } from '@/lib/review/surface';

import { CodeSection } from './code-section';
import { DetailArticle, DetailSection, Kicker, KickerText, WhereButton } from './detail-parts';
import { EvidenceBlock } from './evidence-block';
import { InlineText } from '@/components/common/inline-text';

/** The sources a reviewer leaned on: where each is, and what it says. */
function Contract({ items }: { items: Receipt['contract'] }) {
	return (
		<ul className="receipt-list">
			{items.map((item, index) => (
				<li key={index}>
					<span className="truncate font-mono text-[11.5px] leading-[1.75] text-fg-faint">{item.location}</span>
					<span>
						<InlineText text={item.note} />
					</span>
				</li>
			))}
		</ul>
	);
}

/** The inputs a reviewer tried, each with the behavior it expected. */
function Partitions({ items }: { items: Receipt['partitions'] }) {
	return (
		<ul className="receipt-list">
			{items.map((item, index) => (
				<li key={index}>
					<span className="truncate text-[12px] leading-[1.75] text-fg-faint">{item.label}</span>
					<span>
						<code className="inline-code">{item.input}</code> <span className="text-fg-subtle">→</span>{' '}
						<InlineText text={item.expected} />
					</span>
				</li>
			))}
		</ul>
	);
}

/** One receipt, mounted per item so moving between receipts swaps content with no animation. */
function ReceiptDetail({ receipt }: { receipt: Receipt }) {
	return (
		<DetailArticle label={plain(receipt.question)}>
			<header className="mb-[18px]">
				<Kicker>
					<Pill tone={receipt.verdict === 'holds' ? 'ok' : 'question'}>
						{receipt.verdict === 'holds' ? 'Holds' : 'Not applicable'}
					</Pill>
					<KickerText>Checked for you</KickerText>
				</Kicker>
				<h2 className="detail-title">
					<InlineText text={receipt.question} />
				</h2>
				<WhereButton file={receipt.file} line={receipt.line} symbol={receipt.symbol} />
			</header>

			<Markdown variant="ai" className="detail-body">
				{receipt.reason}
			</Markdown>

			{receipt.evidence ? (
				<DetailSection title="Evidence">
					<EvidenceBlock evidence={receipt.evidence} />
				</DetailSection>
			) : null}

			{receipt.partitions.length > 0 ? (
				<DetailSection title="Inputs it tried">
					<Partitions items={receipt.partitions} />
				</DetailSection>
			) : null}

			{receipt.contract.length > 0 ? (
				<DetailSection title="What it relied on">
					<Contract items={receipt.contract} />
				</DetailSection>
			) : null}

			<CodeSection file={receipt.file} line={receipt.line} endLine={receipt.line} side="new" radius={3} />
		</DetailArticle>
	);
}

/** One receipt: a question a reviewer checked, and why it holds. */
export function ReceiptView({ id }: { id: string }) {
	const receipt = useReview((state) => surfaceOf(state)?.receipts.find((item) => item.id === id) ?? null);

	if (!receipt) return null;

	return <ReceiptDetail key={receipt.id} receipt={receipt} />;
}
