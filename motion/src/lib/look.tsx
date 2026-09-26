// defineLook(): common props + look props -> zod schema, defaults, and a shell component that
// loads fonts, paints the optional background, applies `delay` and the generic exit (`outro`).
import React, {createContext, useContext, useMemo} from 'react';
import {AbsoluteFill, Sequence, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import {breathe, ease, prog} from './anim';
import {rgba} from './color';
import {fontRequests, useFontsReady, type FontRequest} from './fonts';
import {commonShape, type CommonProps, type Font2Props, type FontProps, type LookCategory, type LookKind, type Theme} from './schema';

export type LookCtx = {
	W: number;
	H: number;
	/** design unit: min(W, H) / 1080 px */
	u: number;
	fps: number;
	/** frames of content (duration minus delay) */
	D: number;
	/** seconds of content */
	Ds: number;
	portrait: boolean;
	landscape: boolean;
	square: boolean;
	theme: Theme;
	font: FontProps;
	font2: Font2Props;
	/** 0..1 progress of the exit animation (only for looks with customOutro) */
	exit: number;
	outro: number;
	transparent: boolean;
};

const Ctx = createContext<LookCtx | null>(null);
export const useLook = () => {
	const c = useContext(Ctx);
	if (!c) throw new Error('useLook() outside a look');
	return c;
};

/** Seconds since the look started (after `delay`). */
export const useT = () => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	return frame / fps;
};

/** Resolve an image prop to a URL (public-relative paths go through staticFile). */
export const assetSrc = (p: string) => {
	if (!p) return '';
	if (/^(https?:|data:|blob:)/.test(p)) return p;
	return staticFile(p.replace(/^\/+/, '').replace(/^public\//, ''));
};

type AnyShape = z.ZodRawShape;

export type LookProps<S extends AnyShape> = z.output<z.ZodObject<S>> & CommonProps;

export type LookDefInput<S extends AnyShape> = {
	id: string;
	category: LookCategory;
	kind: LookKind;
	description: string;
	duration: number;
	transparent?: boolean;
	font?: Partial<FontProps>;
	outro?: number;
	/** true: the look animates its own exit via useLook().exit; false: shell fades/blurs it out */
	customOutro?: boolean;
	/** extra font weights of the primary family the look uses (e.g. 600 for labels) */
	weights?: number[];
	/** set false if the look never uses font2 */
	usesFont2?: boolean;
	extraFonts?: (p: CommonProps & Record<string, unknown>) => FontRequest[];
	props: S;
	render: React.FC<{p: LookProps<S>}>;
};

export type LookDef = {
	id: string;
	category: LookCategory;
	kind: LookKind;
	description: string;
	duration: number;
	schema: z.ZodObject<AnyShape>;
	defaults: Record<string, unknown>;
	component: React.FC<Record<string, unknown>>;
};

export function defineLook<S extends AnyShape>(def: LookDefInput<S>): LookDef {
	const isBg = def.kind === 'background';
	const common = commonShape({duration: def.duration, transparent: false});
	for (const k of Object.keys(def.props)) {
		if (k in common) throw new Error(`look "${def.id}": prop "${k}" collides with a common prop`);
	}
	const schema = z.object({
		...commonShape({
			duration: def.duration,
			transparent: isBg ? false : (def.transparent ?? def.kind === 'overlay'),
			font: def.font,
			outro: isBg ? 0 : def.outro,
		}),
		...def.props,
	});
	const defaults = schema.parse({}) as Record<string, unknown>;
	const Inner = def.render as React.FC<{p: unknown}>;

	const Shell: React.FC<Record<string, unknown>> = (raw) => {
		// Props normally arrive parsed from calculateMetadata; parse again defensively (Studio edits).
		const p = useMemo(() => schema.parse(raw) as unknown as CommonProps & Record<string, unknown>, [raw]);
		const frame = useCurrentFrame();
		const {fps, durationInFrames, width: W, height: H} = useVideoConfig();
		const reqs = useMemo(
			() => [
				...fontRequests(p.font, def.usesFont2 === false ? null : p.font2, def.weights ?? []),
				...(def.extraFonts ? def.extraFonts(p) : []),
			],
			[p],
		);
		const ready = useFontsReady(reqs);
		const delayF = isBg ? 0 : Math.round(p.delay * fps);
		const D = Math.max(1, durationInFrames - delayF);
		const outroF = isBg ? 0 : Math.min(Math.round(p.outro * fps), Math.floor(D * 0.5));
		const local = frame - delayF;
		const exit = outroF > 0 ? prog(local, D - outroF, D, ease.inCubic) : 0;
		const u = Math.min(W, H) / 1080;
		const ctx: LookCtx = {
			W,
			H,
			u,
			fps,
			D,
			Ds: D / fps,
			portrait: H > W * 1.15,
			landscape: W > H * 1.15,
			square: !(H > W * 1.15) && !(W > H * 1.15),
			theme: p.theme,
			font: p.font,
			font2: p.font2,
			exit,
			outro: outroF / fps,
			transparent: p.transparent,
		};
		const generic = !def.customOutro && exit > 0;
		const exitStyle: React.CSSProperties = generic
			? {
					opacity: 1 - exit,
					transform: `scale(${1 - 0.06 * exit}) translateY(${-24 * u * exit}px)`,
					filter: exit > 0.02 ? `blur(${10 * u * exit}px)` : undefined,
				}
			: {};
		return (
			<AbsoluteFill style={{backgroundColor: 'transparent', overflow: 'hidden'}}>
				{!isBg && !p.transparent ? <StageBackground theme={p.theme} /> : null}
				{ready ? (
					<Sequence from={delayF} layout="none" name={def.id}>
						<Ctx.Provider value={ctx}>
							<AbsoluteFill style={exitStyle}>
								<Inner p={p} />
							</AbsoluteFill>
						</Ctx.Provider>
					</Sequence>
				) : null}
			</AbsoluteFill>
		);
	};
	Shell.displayName = `Look(${def.id})`;

	return {
		id: def.id,
		category: def.category,
		kind: def.kind,
		description: def.description,
		duration: def.duration,
		schema: schema as unknown as z.ZodObject<AnyShape>,
		defaults,
		component: Shell,
	};
}

/** Themed "stage" painted behind overlays when transparent=false. */
export const StageBackground: React.FC<{theme: Theme}> = ({theme}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const b = breathe(frame / fps, 5);
	return (
		<AbsoluteFill style={{backgroundColor: theme.bg}}>
			<AbsoluteFill
				style={{
					background: `radial-gradient(ellipse 75% 42% at 50% ${48 + 4 * b}%, ${rgba(theme.glow, 0.28 + 0.06 * b)} 0%, ${rgba(theme.glow, 0.1)} 45%, transparent 75%)`,
				}}
			/>
			<AbsoluteFill
				style={{
					background: `radial-gradient(ellipse 90% 38% at 50% 105%, ${rgba(theme.accent2, 0.22)} 0%, transparent 70%)`,
				}}
			/>
			<AbsoluteFill style={{background: 'radial-gradient(ellipse 120% 90% at 50% 50%, transparent 55%, rgba(0,0,0,0.5) 100%)'}} />
		</AbsoluteFill>
	);
};
