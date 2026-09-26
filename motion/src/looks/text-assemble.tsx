import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {breathe, lerp, map, rnd, sp} from '../lib/anim';
import {glowShadow, liftShadow} from '../lib/color';
import {font2Css, fontCss} from '../lib/fonts';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {fitFontSize} from '../lib/measure';
import {parseRich} from '../lib/rich';
import {bool, num, oneOf, str} from '../lib/schema';
import {Anchor} from '../lib/text';

const props = {
	text: str('Built for **travelers.**', 'Text; **word** = accent colour, *word* = italic font2, \\n = line break'),
	size: num(132, 'Font size in design units (auto-shrinks to fit)', 20, 500),
	maxWidth: num(0.86, 'Max text width as a fraction of the frame width', 0.2, 1),
	upper: bool(false, 'ALL CAPS'),
	stagger: num(0.035, 'Seconds between letters', 0, 0.5),
	spread: num(560, 'How far letters start from their final place (design units)', 0, 3000),
	spin: num(150, 'Max start rotation of a letter in degrees', 0, 720),
	order: oneOf(['random', 'left', 'center'] as const, 'random', 'Letter arrival order'),
	shimmer: bool(true, 'Light sweep across the word once assembled'),
	glow: num(0.6, 'Glow intensity 0-1', 0, 1),
	x: num(0.5, 'Horizontal centre (fraction of width)', 0, 1),
	y: num(0.5, 'Vertical centre (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const TextAssemble: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, font2, Ds} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const rich = useMemo(() => parseRich(p.text, {upper: p.upper}), [p.text, p.upper]);
	const style: React.CSSProperties = {...fontCss(font), letterSpacing: '-0.01em', lineHeight: 1.04};
	const maxW = p.maxWidth * W;
	const size = useMemo(
		() => fitFontSize({text: rich.plain, style, base: p.size * u, maxWidth: maxW, maxHeight: H * 0.6}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[rich.plain, p.size, u, maxW, H, font.family, font.weight, font.stretch],
	);
	const n = Math.max(1, rich.chars);
	// arrival rank per visible char
	const rank = useMemo(() => {
		const idx = Array.from({length: n}, (_, i) => i);
		if (p.order === 'left') return idx;
		if (p.order === 'center') {
			const c = (n - 1) / 2;
			const sorted = [...idx].sort((a, b) => Math.abs(a - c) - Math.abs(b - c));
			const r = new Array(n);
			sorted.forEach((ci, k) => (r[ci] = k));
			return r;
		}
		const sorted = [...idx].sort((a, b) => rnd(`as${a}`) - rnd(`as${b}`));
		const r = new Array(n);
		sorted.forEach((ci, k) => (r[ci] = k));
		return r as number[];
	}, [n, p.order]);
	const settle = (n - 1) * p.stagger + 0.55;
	const band = p.shimmer ? map(t, [settle, settle + 0.9], [-0.3, 1.3]) : -1;
	const drift = map(t, [0, Ds], [0, 1]);

	return (
		<AbsoluteFill>
			<Anchor x={p.x} y={p.y} W={W} H={H} width={maxW} transform={`translateY(${-14 * u * drift}px) scale(${1 + 0.025 * drift})`}>
				<div style={{...style, fontSize: size, textAlign: 'center', textWrap: 'balance'} as React.CSSProperties}>
					{rich.lines.map((line, li) => (
						<div key={li}>
							{line.map((w, wi) => {
								let ci = w.charStart;
								return (
									<React.Fragment key={wi}>
										{wi > 0 ? ' ' : null}
										<span style={{display: 'inline-block', whiteSpace: 'nowrap'}}>
											{w.segs.map((seg, si) => (
												<span key={si} style={seg.em ? {...font2Css(font2), fontSize: '1.1em'} : undefined}>
													{Array.from(seg.text).map((ch) => {
														const i = ci++;
														const k = rank[i] ?? i;
														const st = k * p.stagger + rnd(`aj${i}`, 0, 0.05);
														const s = sp(frame, fps, st, {damping: 14, stiffness: 125, mass: 0.85});
														const inv = 1 - s;
														const dx = rnd(`ax${i}`, -1, 1) * p.spread * u;
														const dy = rnd(`ay${i}`, -1, 1) * p.spread * u * 1.15;
														const rot = rnd(`ar${i}`, -1, 1) * p.spin;
														const sc0 = rnd(`ak${i}`, 0.25, 1.9);
														const blur = Math.max(0, inv) * rnd(`ab${i}`, 6, 16) * u;
														const pos = n > 1 ? i / (n - 1) : 0.5;
														const shine = Math.exp(-Math.pow((pos - band) / 0.12, 2));
														const glowI = p.glow * (0.45 + 0.9 * shine + 0.12 * breathe(t, 2.6, pos));
														const color = seg.accent || seg.em ? theme.accent : theme.fg;
														return (
															<span
																key={i}
																style={{
																	display: 'inline-block',
																	color,
																	opacity: Math.min(1, s * 2.4),
																	transform: `translate(${dx * inv}px, ${dy * inv}px) rotate(${rot * inv}deg) scale(${lerp(sc0, 1, s) * (1 + 0.05 * shine)})`,
																	filter: blur > 0.4 ? `blur(${blur}px)` : undefined,
																	textShadow: `${glowShadow(seg.accent || seg.em ? theme.accent : theme.glow, glowI, u)}, ${liftShadow(u, 0.3)}`,
																	whiteSpace: 'pre',
																}}
															>
																{ch}
															</span>
														);
													})}
												</span>
											))}
										</span>
									</React.Fragment>
								);
							})}
						</div>
					))}
				</div>
			</Anchor>
		</AbsoluteFill>
	);
};

export const textAssemble = defineLook({
	id: 'text-assemble',
	category: 'text',
	kind: 'overlay',
	duration: 3,
	description: 'Letters fly in from scattered positions, rotations and scales (with blur) and spring into a clean line; accent words coloured; a light shimmer sweeps across once assembled.',
	props,
	render: TextAssemble,
});
