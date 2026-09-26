// Zod helpers shared by every look. Every field carries a `doc` string (via .meta) so that
// scripts/catalog.mjs can generate catalog.json straight from the schemas.
import {zColor} from '@remotion/zod-types';
import {z} from 'zod';

export const DEFAULT_THEME = {
	bg: '#0E0416',
	fg: '#FFFFFF',
	accent: '#61F0EA',
	accent2: '#B28CFF',
	muted: '#9A8FB0',
	glow: '#7C5CFF',
};

export const DEFAULT_FONT = {family: 'TikTok Sans', weight: 800, stretch: 100};
export const DEFAULT_FONT2 = {family: 'Instrument Serif', weight: 400, style: 'italic' as const};

export const doc = <T extends z.ZodType>(schema: T, text: string): T => schema.meta({doc: text}) as T;

export const color = (def: string, text: string) => doc(zColor().default(def), text);

export const num = (def: number, text: string, min?: number, max?: number) => {
	let s = z.number();
	if (min !== undefined) s = s.min(min);
	if (max !== undefined) s = s.max(max);
	return doc(s.default(def), text);
};

export const int = (def: number, text: string, min?: number, max?: number) => {
	let s = z.number().int();
	if (min !== undefined) s = s.min(min);
	if (max !== undefined) s = s.max(max);
	return doc(s.default(def), text);
};

export const str = (def: string, text: string) => doc(z.string().default(def), text);

export const bool = (def: boolean, text: string) => doc(z.boolean().default(def), text);

export const oneOf = <const T extends readonly [string, ...string[]]>(values: T, def: T[number], text: string) =>
	doc(z.enum(values).default(def as never), text);

/** An image reference: absolute local path (render.mjs copies it into public/_assets), a path inside
 * motion/public, an http(s)/data URL, or '' for none. */
export const asset = (text: string, def = '') => doc(z.string().default(def), `${text} (absolute file path, path inside motion/public, URL, or empty)`);

export const point = (def: [number, number], text: string) =>
	doc(z.tuple([z.number(), z.number()]).default(def), text);

export const strList = (def: string[], text: string) => doc(z.array(z.string()).default(def), text);

export const themeSchema = z.object({
	bg: color(DEFAULT_THEME.bg, 'Background colour (painted only when transparent is false)'),
	fg: color(DEFAULT_THEME.fg, 'Main text colour'),
	accent: color(DEFAULT_THEME.accent, 'Accent colour (keywords, highlights, buttons)'),
	accent2: color(DEFAULT_THEME.accent2, 'Secondary accent (gradients, secondary marks)'),
	muted: color(DEFAULT_THEME.muted, 'Muted colour (labels, secondary text)'),
	glow: color(DEFAULT_THEME.glow, 'Glow / bloom colour'),
});

const fontSchemaWith = (d: {family: string; weight: number; stretch: number}) =>
	z.object({
		family: str(d.family, 'Font family: a family from brand/fonts (e.g. "TikTok Sans", "Inter Display", "Montserrat") or an installed system font'),
		weight: num(d.weight, 'Font weight (100-1000)', 100, 1000),
		stretch: num(d.stretch, 'Font width in % for variable fonts with a width axis (TikTok Sans: 75 condensed ... 150 wide)', 50, 200),
	});

const font2Schema = z.object({
	family: str(DEFAULT_FONT2.family, 'Secondary family for italic/editorial accents; falls back to system serifs (Didot, Georgia) if not installed'),
	weight: num(DEFAULT_FONT2.weight, 'Font weight (100-1000)', 100, 1000),
	style: oneOf(['italic', 'normal'] as const, 'italic', 'Font style'),
});

export type LookKind = 'overlay' | 'background' | 'scene';
export type LookCategory = 'text' | 'number' | 'brand' | 'fx' | 'ui' | 'diagram' | 'data' | 'background';

export type CommonDefaults = {
	duration: number;
	transparent: boolean;
	font?: Partial<typeof DEFAULT_FONT>;
	outro?: number;
};

export const commonShape = (d: CommonDefaults) => {
	const font = {...DEFAULT_FONT, ...(d.font ?? {})};
	return {
		width: int(1080, 'Output width in px (1080x1920 primary; 1920x1080 and 1080x1080 supported)', 16, 7680),
		height: int(1920, 'Output height in px', 16, 7680),
		fps: num(30, 'Frames per second', 1, 120),
		duration: num(d.duration, 'Length in seconds', 0.1, 600),
		transparent: bool(d.transparent, 'true = nothing painted behind the graphic (alpha overlay layer); false = paint a themed background. Backgrounds ignore it'),
		theme: doc(themeSchema.default(DEFAULT_THEME), 'Colours (hex)'),
		font: doc(fontSchemaWith(font).default(font), 'Primary font'),
		font2: doc(font2Schema.default(DEFAULT_FONT2), 'Secondary font (italic / editorial accents)'),
		delay: num(0, 'Seconds before the animation starts (the layer is empty until then)', 0, 600),
		outro: num(d.outro ?? 0.35, 'Exit animation at the end, in seconds (0 = hold the last pose until the end)', 0, 10),
	};
};

export type Theme = typeof DEFAULT_THEME;
export type FontProps = {family: string; weight: number; stretch: number};
export type Font2Props = {family: string; weight: number; style: 'italic' | 'normal'};

export type CommonProps = {
	width: number;
	height: number;
	fps: number;
	duration: number;
	transparent: boolean;
	theme: Theme;
	font: FontProps;
	font2: Font2Props;
	delay: number;
	outro: number;
};
