import React, {useMemo} from 'react';
import {AbsoluteFill, spring} from 'remotion';
import {clamp01, ease, lerp, prog} from '../lib/anim';
import {fontCss} from '../lib/fonts';
import {defineLook, useLook, useT, type LookProps} from '../lib/look';
import {measureText} from '../lib/measure';
import {num, oneOf, str} from '../lib/schema';

const props = {
	name: str('Your App', 'Wordmark text (the full stop is drawn separately, as `dot`)'),
	dot: str('.', 'The mark the wordmark squeezes into: "." (a round dot, drawn) or empty (squeeze into the last letter\'s edge)'),
	label: str('', 'Text that rises inside the pill once the dot has grown (e.g. "Get the app"); empty = the dot grows into a plain pill'),
	mode: oneOf(['both', 'squeeze', 'return'] as const, 'both',
		'both = squeeze into the dot, the dot grows into the pill, hold, then everything springs back (last frame = first frame: loops); squeeze = only the first half (ends on the pill); return = only the second half (starts on the pill)'),
	size: num(150, 'Wordmark size in design units', 20, 500),
	pillHeight: num(124, 'Pill height in design units', 30, 600),
	pillWidth: num(0, 'Pill width in design units (0 = fit the label)', 0, 1000),
	labelSize: num(46, 'Label size in design units', 8, 200),
	dotColor: str('', 'Dot / pill colour (empty = text colour)'),
	labelColor: str('', 'Label colour (empty = the theme background colour)'),
	speed: num(1, 'Animation speed multiplier (2 = twice as fast)', 0.25, 4),
	x: num(0.5, 'Horizontal centre (fraction of width)', 0, 1),
	y: num(0.5, 'Vertical centre (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const WordmarkSqueeze: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, Ds, theme, font} = useLook();
	const t = useT();
	const sp = Math.max(0.25, p.speed);
	const nameStyle = useMemo<React.CSSProperties>(() => ({...fontCss(font), letterSpacing: '-0.03em', lineHeight: 1, whiteSpace: 'pre'}), [font]);
	const labelStyle = useMemo<React.CSSProperties>(() => ({...fontCss(font, {weight: 600}), lineHeight: 1, whiteSpace: 'pre'}), [font]);

	const geo = useMemo(() => {
		const fs0 = p.size * u;
		const nw0 = p.name ? measureText(p.name, {...nameStyle, fontSize: fs0}).width : 0;
		const d0 = p.dot ? fs0 * 0.2 : 0;
		const gap0 = p.dot ? fs0 * 0.05 : 0;
		const k = Math.min(1, (0.88 * W) / Math.max(1, nw0 + gap0 + d0));
		const lw = p.label ? measureText(p.label, {...labelStyle, fontSize: p.labelSize * u}).width : 0;
		const ph = p.pillHeight * u;
		const pw = p.pillWidth > 0 ? p.pillWidth * u : Math.max(ph * 1.6, lw + ph * 0.9);
		return {fs: fs0 * k, nw: nw0 * k, d: Math.max(d0 * k, 6 * u), gap: gap0 * k, ph, pw};
	}, [p.name, p.dot, p.size, p.label, p.labelSize, p.pillHeight, p.pillWidth, W, u, nameStyle, labelStyle]);
	const {fs, nw, d, gap, ph, pw} = geo;

	// ---- one timeline both ways: squeeze (0 -> 1), grow (dot -> pill), label rises; mirrored on the way back
	const SQ = 0.5 / sp, GR = 0.45 / sp, LB = 0.35 / sp;   // squeeze, grow, label
	const fwd = (tt: number) => ({
		sq: ease.inOutExpo(prog(tt, 0.12 / sp, 0.12 / sp + SQ)),
		gr: tt < 0.12 / sp + SQ * 0.85 ? 0 : spring({frame: (tt - 0.12 / sp - SQ * 0.85) * fps * sp, fps, config: {damping: 14, stiffness: 190, mass: 0.7}}),
		lb: ease.outExpo(prog(tt, 0.12 / sp + SQ + GR * 0.7, 0.12 / sp + SQ + GR * 0.7 + LB)),
	});
	// the way back is the same timeline run backwards from the end, so the last frame is the first frame
	const s = p.mode === 'squeeze' ? fwd(t) : p.mode === 'return' ? fwd(Ds - t) : fwd(t < Ds / 2 ? t : Ds - t);
	const sqv = s.sq;

	// ---- layout: the lockup [name][gap][dot] is centred on (x, y); the name folds toward the dot's centre
	const cx = p.x * W, cy = p.y * H;
	const left = cx - (nw + gap + d) / 2;
	const dotX = left + nw + gap + d / 2;
	const nameScale = Math.max(0.0001, 1 - sqv);
	// once squeezed, the dot slides to the centre as it grows into the pill
	const gr = s.gr;
	const pillCx = lerp(dotX, cx, clamp01(gr));
	const pwNow = lerp(d, pw, gr), phNow = lerp(d, ph, gr);
	const dotC = p.dotColor || theme.fg;
	const labC = p.labelColor || theme.bg;
	const lfs = p.labelSize * u;

	return (
		<AbsoluteFill>
			{nameScale > 0.002 && p.name ? (
				<div
					style={{
						position: 'absolute',
						left,
						top: cy - fs * 0.5,
						width: nw,
						height: fs,
						...nameStyle,
						fontSize: fs,
						color: theme.fg,
						transform: `scaleX(${nameScale})`,
						transformOrigin: `${dotX - left}px 50%`,
						opacity: clamp01((1 - sqv) / 0.12),
						display: 'flex',
						alignItems: 'center',
					}}
				>
					{p.name}
				</div>
			) : null}
			<div
				style={{
					position: 'absolute',
					left: pillCx - pwNow / 2,
					top: cy + fs * 0.28 * (1 - clamp01(gr)) - phNow / 2,
					width: pwNow,
					height: phNow,
					borderRadius: phNow / 2,
					background: dotC,
					overflow: 'hidden',
					opacity: p.dot || gr > 0.01 ? 1 : 0,
				}}
			>
				{p.label && s.lb > 0.001 ? (
					<div
						style={{
							position: 'absolute',
							left: 0,
							right: 0,
							top: (phNow - lfs) / 2 + (1 - s.lb) * phNow * 0.9,
							textAlign: 'center',
							...labelStyle,
							fontSize: lfs,
							color: labC,
						}}
					>
						{p.label}
					</div>
				) : null}
			</div>
		</AbsoluteFill>
	);
};

export const wordmarkSqueeze = defineLook({
	id: 'wordmark-squeeze',
	category: 'brand',
	kind: 'overlay',
	duration: 3.2,
	outro: 0,
	font: {weight: 800},
	usesFont2: false,
	weights: [600],
	description:
		'Accordion wordmark: the name squeezes into its own full stop (every letter moves toward the dot by the same factor and narrows, so they stay touching), the dot grows into a pill and a label rises inside it out of a mask line; mode both springs it all back at the end so the last frame matches the first (a loop-ready opener / end card).',
	props,
	render: WordmarkSqueeze,
});
