import {getLength} from '@remotion/paths';
import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {breathe, ease, map, prog} from '../lib/anim';
import {glowShadow, liftShadow, rgba} from '../lib/color';
import {font2Css, fontCss} from '../lib/fonts';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {fitFontSize, measureText} from '../lib/measure';
import {parseRich} from '../lib/rich';
import {bool, num, str} from '../lib/schema';
import {Anchor} from '../lib/text';

const props = {
	text: str('Plan less.\n*Travel more.*', 'Text; *word* = italic font2 accent (underlined), **word** = accent colour, \\n = line break'),
	size: num(112, 'Font size in design units (auto-shrinks to fit)', 20, 400),
	emScale: num(1.22, 'Size of the italic words relative to the sans words', 0.5, 2),
	maxWidth: num(0.86, 'Max text width as a fraction of the frame width', 0.2, 1),
	stagger: num(0.09, 'Seconds between words', 0, 1),
	underline: bool(true, 'Hand-drawn underline under the italic words'),
	glow: num(0.5, 'Glow intensity 0-1', 0, 1),
	x: num(0.5, 'Horizontal centre (fraction of width)', 0, 1),
	y: num(0.5, 'Vertical centre (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const Underline: React.FC<{w: number; fs: number; p: number; color: string; u: number; t: number}> = ({w, fs, p, color, u, t}) => {
	const h = fs * 0.34;
	const d = `M ${0.01 * w} ${0.66 * h} C ${0.26 * w} ${0.34 * h}, ${0.6 * w} ${0.22 * h}, ${0.985 * w} ${0.44 * h}`;
	const d2 = `M ${0.06 * w} ${0.78 * h} C ${0.32 * w} ${0.52 * h}, ${0.66 * w} ${0.42 * h}, ${0.93 * w} ${0.6 * h}`;
	const L = useMemo(() => getLength(d), [d]);
	const L2 = useMemo(() => getLength(d2), [d2]);
	const sw = Math.max(3, fs * 0.075);
	const p2 = Math.min(1, Math.max(0, (p - 0.25) / 0.75));
	const g = 0.6 + 0.4 * breathe(t, 2.4);
	return (
		<svg
			width={w}
			height={h}
			style={{position: 'absolute', left: 0, top: '100%', marginTop: -fs * 0.2, overflow: 'visible', filter: `drop-shadow(0 0 ${8 * u}px ${rgba(color, 0.65 * g)})`}}
		>
			<path d={d} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeDasharray={L} strokeDashoffset={L * (1 - p)} />
			<path d={d2} fill="none" stroke={color} strokeOpacity={0.55} strokeWidth={sw * 0.45} strokeLinecap="round" strokeDasharray={L2} strokeDashoffset={L2 * (1 - p2)} />
		</svg>
	);
};

const TextItalic: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, font2, Ds} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const rich = useMemo(() => parseRich(p.text), [p.text]);
	const style: React.CSSProperties = {...fontCss(font), letterSpacing: '-0.015em', lineHeight: 1.08};
	const maxW = p.maxWidth * W;
	const size = useMemo(
		() => fitFontSize({text: rich.plain, style, base: p.size * u, maxWidth: maxW / 1.08, maxHeight: H * 0.6}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[rich.plain, p.size, u, maxW, H, font.family, font.weight, font.stretch],
	);
	const emStyle = {...font2Css(font2), letterSpacing: '-0.01em'};
	const drift = map(t, [0, Ds], [0, 1]);
	const lastStart = 0.1 + Math.max(0, rich.words.length - 1) * p.stagger;
	return (
		<AbsoluteFill>
			<Anchor x={p.x} y={p.y} W={W} H={H} width={maxW} transform={`scale(${1 + 0.025 * drift})`}>
				<div style={{...style, fontSize: size, textAlign: 'center', textWrap: 'balance'} as React.CSSProperties}>
					{rich.lines.map((line, li) => (
						<div key={li}>
							{line.map((w, wi) => {
								const s0 = 0.1 + w.index * p.stagger + (w.em ? 0.12 : 0);
								const e = ease.outExpo(prog(t, s0, s0 + 0.8));
								const ulStart = Math.max(s0 + 0.35, lastStart + 0.3);
								const ul = ease.inOutCubic(prog(t, ulStart, ulStart + 0.6));
								return (
									<React.Fragment key={wi}>
										{wi > 0 ? ' ' : null}
										<span
											style={{
												display: 'inline-block',
												whiteSpace: 'nowrap',
												opacity: e,
												transform: `translateY(${(1 - e) * 0.42}em) scale(${w.em ? 1 + 0.12 * (1 - e) : 1})`,
												filter: e < 0.97 ? `blur(${(1 - e) * 10 * u}px)` : undefined,
											}}
										>
											{w.segs.map((s, si) => {
												if (!s.em) {
													return (
														<span key={si} style={{color: s.accent ? theme.accent : theme.fg, textShadow: `${glowShadow(s.accent ? theme.accent : theme.glow, p.glow * 0.4, u)}, ${liftShadow(u, 0.3)}`}}>
															{s.text}
														</span>
													);
												}
												const fsEm = size * p.emScale;
												const wEm = measureText(s.text, {...emStyle, fontSize: fsEm}).width;
												return (
													<span
														key={si}
														style={{
															...emStyle,
															position: 'relative',
															display: 'inline-block',
															fontSize: `${p.emScale}em`,
															lineHeight: 0.9,
															color: theme.accent,
															paddingRight: '0.04em',
															textShadow: `${glowShadow(theme.accent, p.glow * (0.6 + 0.3 * breathe(t, 2.4)), u)}, ${liftShadow(u, 0.3)}`,
														}}
													>
														{s.text}
														{p.underline && ul > 0 ? <Underline w={wEm} fs={fsEm} p={ul} color={theme.accent} u={u} t={t} /> : null}
													</span>
												);
											})}
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

export const textItalic = defineLook({
	id: 'text-italic',
	category: 'text',
	kind: 'overlay',
	duration: 3,
	description: 'Editorial line: sans words rise in with blur, the *italic* serif accent word (font2, Instrument Serif) lands larger in the accent colour and a hand-drawn underline draws itself beneath it.',
	props,
	render: TextItalic,
});
