import { RadioGroup } from '@recoder/ui';
import { Check } from 'lucide-react';

import { PALETTE, type PaletteId } from '@/lib/appearance/choices';

interface PalettePickerProps {
	value: PaletteId;
	onPick: (palette: PaletteId) => void;
}

/**
 * The palettes as a grid of swatches in one radio group: arrow keys move the
 * pick, and every pick shows at once, so stepping through them previews each.
 */
export function PalettePicker({ value, onPick }: PalettePickerProps) {
	/** The group gives back a string; only a palette's own id is ever picked. */
	function pick(id: string): void {
		const next = PALETTE.options.find((option) => option.id === id);

		if (next) onPick(next.id);
	}

	const options = PALETTE.options.map((option) => ({
		value: option.id,
		label: <PaletteSwatch id={option.id} name={option.name} chosen={option.id === value} />
	}));

	return (
		<RadioGroup className="palette-picker" aria-label="Palette" value={value} onValueChange={pick} options={options} />
	);
}

interface PaletteSwatchProps {
	id: PaletteId;
	name: string;
	chosen: boolean;
}

/**
 * A small window of one palette over its name: the chrome, two lines of text,
 * a field and the primary. The window carries the palette's attribute, so it
 * draws with the same tokens the page would take. The default palette is the
 * app's own tokens, which `app-skin` sets again on the window.
 */
function PaletteSwatch({ id, name, chosen }: PaletteSwatchProps) {
	const isDefault = id === PALETTE.fallback;

	return (
		<span className="palette-swatch">
			<span
				className={isDefault ? 'palette-preview app-skin' : 'palette-preview'}
				data-palette={isDefault ? undefined : id}
				aria-hidden
			>
				<span className="palette-preview-chrome" />
				<span className="palette-preview-body">
					<span className="palette-preview-text" data-tone="primary" />
					<span className="palette-preview-text" data-tone="muted" />
					<span className="palette-preview-controls">
						<span className="palette-preview-field" />
						<span className="palette-preview-primary" />
					</span>
				</span>
			</span>
			<span className="palette-swatch-name">
				{name}
				{chosen ? <Check aria-hidden /> : null}
			</span>
		</span>
	);
}
