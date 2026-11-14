'use client';

import { X } from 'lucide-react';

import { Button } from '../button';
import { Tooltip } from '../overlay/tooltip';
import type { InlineImage } from './link-image';

/** One image as a chip shows it. */
export interface ImageChip {
	id: string;
	name: string;
	/** Where the thumbnail loads from: the API's path for an image already sent, or its own bytes while it is on its way. */
	src: string;
	/** Opens the full image in a new tab. */
	href?: string;
}

interface ImageChipsProps {
	images: readonly ImageChip[];
	className?: string;
}

/** The images a sent message holds, as a row of small chips: a thumbnail and the file's name, each opening its image. */
export function ImageChips({ images, className }: ImageChipsProps) {
	if (images.length === 0) return null;

	return (
		<ul data-ui="image-chips" aria-label="Images" className={className}>
			{images.map((image) => (
				<li key={image.id} data-ui="image-chip">
					<ChipBody image={image} />
				</li>
			))}
		</ul>
	);
}

/** The thumbnail and name; a link to the full image when it has one. */
function ChipBody({ image }: { image: ImageChip }) {
	const body = (
		<>
			<Thumbnail src={image.src} alt="" ui="image-chip-thumb" />
			<span data-ui="image-chip-name">{image.name}</span>
		</>
	);

	if (!image.href) return <span data-ui="image-chip-body">{body}</span>;

	return (
		<a data-ui="image-chip-body" href={image.href} target="_blank" rel="noreferrer">
			{body}
		</a>
	);
}

interface ImageTilesProps {
	images: readonly InlineImage[];
	/** Shows a remove button on each tile's corner. */
	onRemove?: (id: string) => void;
}

/** The images a composer holds, as a row of square tiles over its text, each with a round remove button on its corner. */
export function ImageTiles({ images, onRemove }: ImageTilesProps) {
	if (images.length === 0) return null;

	return (
		<ul data-ui="image-tiles" aria-label="Images">
			{images.map((image) => (
				<li key={image.id} data-ui="image-tile">
					<Thumbnail src={image.src} alt={image.name} ui="image-tile-thumb" />
					{onRemove ? (
						<span data-ui="image-tile-corner">
							<Tooltip content="Remove">
								<Button
									variant="secondary"
									size="icon"
									aria-label={`Remove ${image.name}`}
									data-ui="image-tile-remove"
									onClick={() => onRemove(image.id)}
								>
									<X />
								</Button>
							</Tooltip>
						</span>
					) : null}
				</li>
			))}
		</ul>
	);
}

/**
 * A small preview of an image the page already holds: an object URL for one being written, the API's path for one
 * sent. The kit renders in any React host, so it is a plain image rather than one framework's optimised one.
 */
function Thumbnail({ src, alt, ui }: { src: string; alt: string; ui: string }) {
	/* eslint-disable-next-line @next/next/no-img-element -- an object URL or a small API thumbnail: there is nothing for an image optimiser to fetch or resize, and the kit is not tied to Next. */
	return <img src={src} alt={alt} data-ui={ui} draggable={false} />;
}
