import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {ease, map, prog, rnd} from '../lib/anim';
import {liftShadow, onColor, rgba} from '../lib/color';
import {font2Css, fontCss} from '../lib/fonts';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {fitFontSize} from '../lib/measure';
import {parseRich, type Word} from '../lib/rich';
import {bool, num, str} from '../lib/schema';
import {Anchor} from '../lib/text';

const props = {
	text: str('Keep **every detail**\nin one place.', 'Text; **words** get the highlighter sweep, *word* = italic font2, \\n = line break'),
	size: num(100, 'Font size in design units (auto-shrinks to fit)', 20, 400),
	maxWidth: num(0.86, 'Max text width as a fraction of the frame width', 0.2, 1),
	upper: bool(false, 'ALL CAPS'),
	stagger: num(0.07, 'Seconds between words fading in', 0, 1),
	sweep: num(0.5, 'Seconds for one highlighter stroke', 0.1, 3),
	marker: str('', 'Highlighter colour (hex); empty = theme.accent'),
	opacity: num(0.95, 'Highlighter opacity', 0.1, 1),
	tilt: num(-1.1, 'Highlighter tilt in degrees', -10, 10),
	x: num(0.5, 'Horizontal centre (fraction of width)', 0, 1),
	y: num(0.5, 'Vertical centre (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const markerShape = (seed: string) => {
	const n = 10;
	const top: string[] = [];
	const bottom: string[] = [];
	for (let i = 0; i <= n; i++) {
		const x = 2.5 + (i / n) * 94;
		top.push(`${x.toFixed(2)},${(2.2 + rnd(`${seed}t${i}`, -1.1, 1.1)).toFixed(2)}`);
	}
	for (let i = n; i >= 0; i--) {
		const x = 0.5 + (i / n) * 95.5;
		bottom.push(`${x.toFixed(2)},${(18 + rnd(`${seed}b${i}`, -1.1, 1.1)).toFixed(2)}`);
	}
	const tr = top[top.length - 1].split(',');
	const br = bottom[0].split(',');
	return `M ${top[0]} L ${top.slice(1).join(' L ')} Q ${Number(tr[0]) + 4.5},${(Number(tr[1]) + Number(br[1])) / 2} ${br[0]},${br[1]} L ${bottom.slice(1).join(' L ')} Q -0.8,10 ${top[0]} Z`;
};

type Group = {words: Word[]; marked: boolean};

const TextMarker: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, font2, Ds} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const rich = useMemo(() => parseRich(p.text, {upper: p.upper}), [p.text, p.upper]);
	const style: React.CSSProperties = {...fontCss(font), letterSpacing: '-0.012em', lineHeight: 1.22};
	const maxW = p.maxWidth * W;
	const size = useMemo(
		() => fitFontSize({text: rich.plain, style, base: p.size * u, maxWidth: maxW * 0.95, maxHeight: H * 0.6}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[rich.plain, p.size, u, maxW, H, font.family, font.weight, font.stretch],
	);
	// group consecutive words of one **span** so the highlighter runs through them as one stroke
	const lines = useMemo(
		() =>
			rich.lines.map((line) => {
				const groups: Group[] = [];
				for (const w of line) {
					const last = groups[groups.length - 1];
					if (w.accent && last && last.marked && last.words[last.words.length - 1].span === w.span) last.words.push(w);
					else groups.push({words: [w], marked: w.accent});
				}
				return groups;
			}),
		[rich],
	);
	const markedGroups = lines.flat().filter((g) => g.marked);
	const wordsIn = 0.1 + Math.max(0, rich.words.length - 1) * p.stagger + 0.45;
	const markerColor = p.marker || theme.accent;
	const ink = onColor(markerColor);
	const drift = map(t, [0, Ds], [0, 1]);
	const renderWords = (g: Group, color: string, accentColor: string) =>
		g.words.map((w, wi) => (
			<React.Fragment key={wi}>
				{wi > 0 ? ' ' : null}
				{w.segs.map((s, si) => (
					<span key={si} style={{color: s.accent ? accentColor : color, ...(s.em ? {...font2Css(font2), fontSize: '1.12em'} : {})}}>
						{s.text}
					</span>
				))}
			</React.Fragment>
		));
	return (
		<AbsoluteFill>
			<Anchor x={p.x} y={p.y} W={W} H={H} width={maxW} transform={`scale(${1 + 0.02 * drift})`}>
				<div style={{...style, fontSize: size, textAlign: 'center', textWrap: 'balance'} as React.CSSProperties}>
					{lines.map((groups, li) => (
						<div key={li}>
							{groups.map((g, gi) => {
								const first = g.words[0];
								const s0 = 0.1 + first.index * p.stagger;
								const e = ease.outCubic(prog(t, s0, s0 + 0.5));
								const k = markedGroups.indexOf(g);
								const m0 = wordsIn + Math.max(0, k) * p.sweep * 0.85;
								const mp = g.marked ? ease.inOutCubic(prog(t, m0, m0 + p.sweep)) : 0;
								const clip = `inset(-30% ${((1 - mp) * 100).toFixed(2)}% -30% -2%)`;
								return (
									<React.Fragment key={gi}>
										{gi > 0 ? ' ' : null}
										<span
											style={{
												position: 'relative',
												display: 'inline-block',
												whiteSpace: 'nowrap',
												opacity: e,
												transform: `translateY(${(1 - e) * 18 * u}px)`,
												filter: e < 0.97 ? `blur(${(1 - e) * 7 * u}px)` : undefined,
											}}
										>
											{g.marked && mp > 0 ? (
												<svg
													viewBox="0 0 100 20"
													preserveAspectRatio="none"
													style={{
														position: 'absolute',
														left: '-0.16em',
														top: '-0.02em',
														width: 'calc(100% + 0.32em)',
														height: 'calc(100% + 0.04em)',
														overflow: 'visible',
														zIndex: 1,
														clipPath: clip,
														transform: `rotate(${p.tilt}deg)`,
														filter: `drop-shadow(0 ${4 * u}px ${12 * u}px ${rgba(markerColor, 0.35)})`,
													}}
												>
													<defs>
														<clipPath id={`mk${li}_${gi}`}>
															<path d={markerShape(`m${li}_${gi}`)} />
														</clipPath>
													</defs>
													<path d={markerShape(`m${li}_${gi}`)} fill={markerColor} opacity={p.opacity} />
													<g clipPath={`url(#mk${li}_${gi})`} opacity={0.5}>
														{[5.2, 8.6, 12.4, 15.6].map((yy, j) => (
															<path
																key={j}
																d={`M -2 ${yy + rnd(`s${li}${gi}${j}`, -0.6, 0.6)} C 30 ${yy - 0.8} 60 ${yy + 0.9} 102 ${yy + rnd(`e${li}${gi}${j}`, -0.6, 0.6)}`}
																stroke={j % 2 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.10)'}
																strokeWidth={j % 2 ? 0.7 : 1.1}
																fill="none"
															/>
														))}
													</g>
												</svg>
											) : null}
											<span
												style={{
													position: 'relative',
													textShadow: liftShadow(u, 0.3),
													color: theme.fg,
													WebkitMaskImage: g.marked && mp > 0 ? `linear-gradient(90deg, transparent ${(mp * 100).toFixed(2)}%, #000 ${(mp * 100).toFixed(2)}%)` : undefined,
													maskImage: g.marked && mp > 0 ? `linear-gradient(90deg, transparent ${(mp * 100).toFixed(2)}%, #000 ${(mp * 100).toFixed(2)}%)` : undefined,
												}}
											>
												{renderWords(g, theme.fg, g.marked ? theme.fg : theme.accent)}
											</span>
											{g.marked && mp > 0 ? (
												<span aria-hidden style={{position: 'absolute', left: 0, top: 0, zIndex: 2, clipPath: clip, color: ink, whiteSpace: 'nowrap'}}>
													{renderWords(g, ink, ink)}
												</span>
											) : null}
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

export const textMarker = defineLook({
	id: 'text-marker',
	category: 'text',
	kind: 'overlay',
	duration: 3,
	description: 'Words fade up, then a highlighter pen sweeps behind the **accent** words (rough hand-drawn edges, streak texture, slight tilt) and the text under it flips to dark ink for contrast.',
	props,
	render: TextMarker,
});
