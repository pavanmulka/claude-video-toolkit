import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {breathe, lerp, map, rnd, shake, sp} from '../lib/anim';
import {glowShadow, liftShadow, onColor, rgba} from '../lib/color';
import {fontCss} from '../lib/fonts';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {measureText} from '../lib/measure';
import {normalizeText, parseRich, stripMarkup} from '../lib/rich';
import {bool, num, oneOf, strList} from '../lib/schema';
import {Anchor, Segs} from '../lib/text';

const props = {
	lines: strList(['STOP', 'DIGGING', 'THROUGH', '**EMAILS.**'], '2-5 short lines, one slam each; a line containing **...** gets the accent chip'),
	size: num(190, 'Font size in design units (auto-shrinks to fit)', 20, 600),
	lineHeight: num(0.9, 'Line height (em)', 0.6, 2),
	maxWidth: num(0.84, 'Max text width as a fraction of the frame width', 0.2, 1),
	upper: bool(true, 'ALL CAPS'),
	justify: bool(false, 'Scale each line to the same width (poster stack)'),
	stagger: num(0.26, 'Seconds between line slams', 0.02, 3),
	shake: num(0.7, 'Camera shake per slam 0-1', 0, 1),
	chip: bool(true, 'Accent lines sit on an accent chip (dark text)'),
	align: oneOf(['center', 'left'] as const, 'center', 'Stack alignment'),
	glow: num(0.5, 'Glow intensity 0-1', 0, 1),
	x: num(0.5, 'Horizontal centre (fraction of width)', 0, 1),
	y: num(0.5, 'Vertical centre (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const IMPACT = 0.09;

const TextStack: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, font2, Ds} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const lines = useMemo(() => p.lines.map((l) => normalizeText(l)).filter((l) => l.trim().length), [p.lines]);
	const riches = useMemo(() => lines.map((l) => parseRich(l.replace(/\n/g, ' '), {upper: p.upper})), [lines, p.upper]);
	const style: React.CSSProperties = {...fontCss(font), letterSpacing: '-0.01em'};
	const maxW = p.maxWidth * W;
	const sizes = useMemo(() => {
		const base = p.size * u;
		const widths = lines.map((l) => measureText(p.upper ? stripMarkup(l).toLocaleUpperCase() : stripMarkup(l), {...style, fontSize: base}).width + (/\*\*/.test(l) && p.chip ? base * 0.36 : 0));
		const widest = Math.max(1, ...widths);
		let k = Math.min(1, maxW / widest);
		let out = widths.map(() => base * k);
		if (p.justify) {
			const target = Math.min(maxW, widest * k);
			out = widths.map((w) => Math.min(base * 1.9, (base * target) / Math.max(1, w)));
		}
		const total = out.reduce((a, b) => a + b * p.lineHeight, 0);
		const maxH = H * 0.72;
		if (total > maxH) {
			k = maxH / total;
			out = out.map((s) => s * k);
		}
		return out;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [lines, p.size, u, maxW, H, p.justify, p.lineHeight, p.upper, p.chip, font.family, font.weight, font.stretch]);
	const impacts = lines.map((_, i) => 0.05 + i * p.stagger + IMPACT);
	const sh = shake(t, impacts, p.shake * 16 * u, 'stack');
	const last = impacts[impacts.length - 1] ?? 0;
	const settleDrift = map(t, [last, Ds], [0, 1]);
	return (
		<AbsoluteFill>
			<Anchor
				x={p.x}
				y={p.y}
				W={W}
				H={H}
				width={maxW}
				transform={`translate(${sh.x}px, ${sh.y}px) rotate(${sh.r}deg) scale(${1 + 0.03 * settleDrift})`}
				style={{display: 'flex', flexDirection: 'column', alignItems: p.align === 'left' ? 'flex-start' : 'center'}}
			>
				{riches.map((rich, i) => {
					const st = 0.05 + i * p.stagger;
					const local = t - st;
					const fs = sizes[i];
					const hasAccent = rich.words.some((w) => w.accent);
					const s = sp(frame, fps, st, {damping: 15, stiffness: 430, mass: 0.7});
					const visible = local >= 0;
					const scale = lerp(1.75, 1, s);
					const blurY = Math.max(0, 1 - s) * 22 * u;
					const flash = local > IMPACT ? Math.exp(-(local - IMPACT) / 0.16) : 0;
					const chipS = hasAccent && p.chip ? sp(frame, fps, st + IMPACT * 0.6, {damping: 13, stiffness: 260, mass: 0.7}) : 0;
					const par = (rnd(`par${i}`, -1, 1) * 6 * u) * settleDrift;
					const onChip = chipS > 0.35;
					return (
						<div
							key={i}
							style={{
								position: 'relative',
								...style,
								fontSize: fs,
								lineHeight: p.lineHeight,
								whiteSpace: 'nowrap',
								opacity: visible ? Math.min(1, local / 0.05) : 0,
								transform: `translateX(${par}px) scale(${scale})`,
								filter: blurY > 0.5 ? `blur(${blurY * 0.35}px)` : flash > 0.05 ? `brightness(${1 + 0.8 * flash})` : undefined,
								padding: hasAccent && p.chip ? `0 ${fs * 0.16}px` : 0,
								margin: hasAccent && p.chip ? `${fs * 0.07}px 0` : 0,
							}}
						>
							{hasAccent && p.chip ? (
								<div
									style={{
										position: 'absolute',
										left: 0,
										right: 0,
										top: fs * 0.02,
										bottom: fs * 0.0,
										borderRadius: fs * 0.14,
										background: theme.accent,
										transform: `rotate(${-2 + 0.6 * breathe(t, 3)}deg) scaleX(${chipS})`,
										boxShadow: `0 ${10 * u}px ${30 * u}px rgba(0,0,0,0.35), 0 0 ${40 * u}px ${rgba(theme.accent, 0.4 * p.glow)}`,
									}}
								/>
							) : null}
							<span
								style={{
									position: 'relative',
									color: theme.fg,
									textShadow: onChip ? 'none' : `${glowShadow(theme.glow, p.glow * (0.3 + 0.8 * flash), u)}, ${liftShadow(u, 0.35)}`,
								}}
							>
								{rich.words.map((w, wi) => (
									<React.Fragment key={wi}>
										{wi > 0 ? ' ' : null}
										<Segs word={w} fg={onChip && hasAccent ? onColor(theme.accent) : theme.fg} accent={onChip ? onColor(theme.accent) : theme.accent} font2={font2} />
									</React.Fragment>
								))}
							</span>
						</div>
					);
				})}
			</Anchor>
		</AbsoluteFill>
	);
};

export const textStack = defineLook({
	id: 'text-stack',
	category: 'text',
	kind: 'overlay',
	duration: 2.8,
	description: '2-5 short heavy condensed lines slam in one after another (scale-slam, blur, flash) with a tiny camera shake on each; the **accent** line lands on an accent chip. justify=true makes a poster stack.',
	font: {weight: 900, stretch: 75},
	props,
	render: TextStack,
});
