import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {breathe, ease, lerp, map, prog, sp} from '../lib/anim';
import {glowShadow, liftShadow, mix, onColor, rgba} from '../lib/color';
import {fontCss} from '../lib/fonts';
import {FitBox} from '../lib/fit';
import {CheckBadge, ShineBand} from '../lib/fx';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {parseRich} from '../lib/rich';
import {bool, int, num, str, strList} from '../lib/schema';
import {Segs} from '../lib/text';

const props = {
	title: str('Everything for **the trip**,\nin one place', 'Title above the grid (**accent**, *italic*, \\n); empty = none'),
	items: strList(['Passports', 'Flights', 'Hotels', 'Car rental'], 'Card labels (2-8 read best)'),
	columns: int(0, 'Columns (0 = auto: 2 on portrait/square, up to 4 on landscape)', 0, 6),
	stagger: num(0.32, 'Seconds between cards', 0.02, 5),
	numbered: bool(true, 'Number badge on each card'),
	check: bool(true, 'Check mark draws on each card after it appears'),
	size: num(46, 'Card label size (design units)', 10, 150),
	titleSize: num(78, 'Title size (design units)', 10, 250),
	y: num(0.5, 'Vertical centre (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const ChecklistGrid: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, font2, landscape, Ds} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const rich = useMemo(() => parseRich(p.title), [p.title]);
	const n = p.items.length;
	const cols = p.columns > 0 ? p.columns : landscape ? Math.min(4, n) : Math.min(2, n);
	const gridW = landscape ? Math.min(W * 0.84, 1700 * u) : Math.min(W * 0.9, 1000 * u);
	const gap = 26 * u;
	const cardW = (gridW - gap * (cols - 1)) / cols;
	const fs = p.size * u;
	const cardH = Math.max(fs * 5.2, cardW * 0.78);
	const titleEnd = 0.1 + rich.words.length * 0.06 + 0.4;
	const allDone = titleEnd + (n - 1) * p.stagger + 1.1;
	const drift = map(t, [0, Ds], [0, 1]);
	return (
		<AbsoluteFill>
			<div style={{position: 'absolute', left: W / 2, top: p.y * H, width: 'max-content', transform: `translate(-50%, -50%) scale(${1 + 0.02 * drift})`}}>
				<FitBox maxWidth={W * 0.96} maxHeight={H * 0.9}>
					<div style={{width: gridW, display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
						{p.title ? (
							<div
								style={{
									...fontCss(font),
									fontSize: p.titleSize * u,
									lineHeight: 1.06,
									letterSpacing: '-0.02em',
									textAlign: 'center',
									color: theme.fg,
									marginBottom: 46 * u,
									textShadow: liftShadow(u, 0.35),
									textWrap: 'balance',
								} as React.CSSProperties}
							>
								{rich.lines.map((line, li) => (
									<div key={li}>
										{line.map((w, wi) => {
											const e = ease.outExpo(prog(t, 0.1 + w.index * 0.06, 0.1 + w.index * 0.06 + 0.7));
											return (
												<React.Fragment key={wi}>
													{wi > 0 ? ' ' : null}
													<span style={{display: 'inline-block', opacity: e, transform: `translateY(${(1 - e) * 0.45}em)`, filter: e < 0.95 ? `blur(${(1 - e) * 8 * u}px)` : undefined, textShadow: w.accent ? glowShadow(theme.accent, 0.4, u) : undefined}}>
														<Segs word={w} fg={theme.fg} accent={theme.accent} font2={font2} />
													</span>
												</React.Fragment>
											);
										})}
									</div>
								))}
							</div>
						) : null}
						<div style={{display: 'grid', gridTemplateColumns: `repeat(${cols}, ${cardW}px)`, gap, perspective: 1400 * u}}>
							{p.items.map((item, i) => {
								const t0 = titleEnd + i * p.stagger;
								const s = sp(frame, fps, t0, {damping: 15, stiffness: 170, mass: 0.9});
								const ck = p.check ? prog(t, t0 + 0.35, t0 + 0.95) : 0;
								const ckPop = p.check ? sp(frame, fps, t0 + 0.35, {damping: 9, stiffness: 240, mass: 0.6}) : 0;
								const done = ck > 0.6;
								const glowK = done ? Math.exp(-Math.max(0, t - t0 - 0.8) / 0.6) : 0;
								const shine = t > allDone ? prog(t, allDone + i * 0.12, allDone + i * 0.12 + 0.7, ease.inOutCubic) : 0;
								return (
									<div
										key={i}
										style={{
											position: 'relative',
											height: cardH,
											boxSizing: 'border-box',
											padding: `${fs * 0.62}px ${fs * 0.7}px`,
											borderRadius: 40 * u,
											overflow: 'hidden',
											display: 'flex',
											flexDirection: 'column',
											justifyContent: 'space-between',
											background: `linear-gradient(160deg, ${rgba(mix(theme.bg, '#FFFFFF', 0.2), 0.72)}, ${rgba(mix(theme.bg, '#FFFFFF', 0.07), 0.66)})`,
											border: `${2 * u}px solid ${rgba(done ? theme.accent : '#FFFFFF', done ? 0.22 + 0.4 * glowK : 0.14)}`,
											boxShadow: `0 ${20 * u}px ${50 * u}px rgba(0,0,0,0.35), inset 0 ${2 * u}px 0 ${rgba('#FFFFFF', 0.14)}, 0 0 ${50 * u}px ${rgba(theme.accent, 0.3 * glowK)}`,
											backdropFilter: `blur(${24 * u}px)`,
											opacity: Math.min(1, s * 1.6),
											transform: `translateY(${(1 - s) * 60 * u}px) rotateX(${(1 - s) * 28}deg) scale(${lerp(0.86, 1, s)})`,
											transformOrigin: 'center bottom',
										}}
									>
										<div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
											{p.numbered ? (
												<div
													style={{
														...fontCss(font, {weight: 800}),
														width: fs * 1.55,
														height: fs * 1.55,
														borderRadius: '50%',
														display: 'flex',
														alignItems: 'center',
														justifyContent: 'center',
														fontSize: fs * 0.78,
														color: onColor(theme.accent2),
														background: theme.accent2,
														boxShadow: `0 0 ${20 * u}px ${rgba(theme.accent2, 0.45)}`,
													}}
												>
													{i + 1}
												</div>
											) : (
												<div />
											)}
											{p.check ? (
												<div style={{transform: `scale(${ck > 0 ? Math.max(0, ckPop) : 0})`}}>
													<CheckBadge p={ck} size={fs * 1.6} color={theme.accent} ink={onColor(theme.accent)} />
												</div>
											) : null}
										</div>
										<div style={{...fontCss(font, {weight: 700}), fontSize: fs, lineHeight: 1.12, color: theme.fg, letterSpacing: '-0.01em'}}>{item}</div>
										<ShineBand p={shine} opacity={0.22} width={0.5} />
										<div style={{position: 'absolute', inset: 0, pointerEvents: 'none', background: `radial-gradient(120% 60% at 0% 0%, ${rgba('#FFFFFF', 0.08 + 0.04 * breathe(t, 3, i * 0.3))}, transparent 60%)`}} />
									</div>
								);
							})}
						</div>
					</div>
				</FitBox>
			</div>
		</AbsoluteFill>
	);
};

export const checklistGrid = defineLook({
	id: 'checklist-grid',
	category: 'ui',
	kind: 'overlay',
	duration: 4.5,
	description: 'Title words rise in, then numbered frosted-glass cards flip up into a 2x2 (or N) grid one by one; a check mark draws itself on each (ring, fill, tick) with an accent glow; a light sweep crosses the finished grid.',
	weights: [700, 800],
	props,
	render: ChecklistGrid,
});
