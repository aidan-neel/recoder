import { cn } from '@recoder/ui';

interface AvatarProps {
	/** The login or name the initial comes from. */
	name: string;
	/** The picture, when the forge has one. It loads over the initial, so a slow or missing picture never leaves a hole. */
	src?: string | null;
	shape?: 'round' | 'square';
	/** `recoder` fills it with the primary color, for Recoder's own messages. */
	tone?: 'person' | 'recoder';
	className?: string;
}

/** A person as an initial on a tint, with their picture over it once it loads. Decorative: the name always stands beside it. */
export function Avatar({ name, src, shape = 'round', tone = 'person', className }: AvatarProps) {
	return (
		<span
			aria-hidden
			data-shape={shape}
			data-recoder={tone === 'recoder' || undefined}
			className={cn('avatar', className)}
		>
			{name.slice(0, 1)}
			{/* eslint-disable-next-line @next/next/no-img-element -- a 24px forge avatar; the image optimizer would add a server hop for nothing */}
			{src ? <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : null}
		</span>
	);
}
