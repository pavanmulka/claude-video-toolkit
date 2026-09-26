import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {breathe, ease, map, prog, sp} from '../lib/anim';
import {glowShadow, liftShadow, onColor, rgba} from '../lib/color';
import {fontCss} from '../lib/fonts';
import {FitBox} from '../lib/fit';
import {GlowBlob, PingRing, ShineBand, shineProgress} from '../lib/fx';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {Logo} from '../lib/logo';
import {parseRich} from '../lib/rich';
import {asset, num, oneOf, str} from '../lib/schema';
import {Segs} from '../lib/text';

const props = {
	logo: asset('Logo image; empty = monogram tile from the name'),
	name: str('Your App', 'App / brand name (used for the monogram and shown next to the logo when showName)'),
	showName: oneOf(['none', 'below', 'right'] as const, 'none', 'Show the name as a wordmark next to the logo'),
	headline: str('Every trip,\n**one place.**', 'Headline (**accent**, *italic* font2, \\n)'),
	cta: str('Get the app', 'Button label (empty = no button)'),
	ctaIcon: oneOf(['arrow', 'download', 'none'] as const, 'arrow', 'Icon on the button'),
	subline: str('On the App Store', 'Small line under the button (empty = none)'),
	rating: num(0, 'Star rating shown with the subline (0 = hidden, e.g. 4.8)', 0, 5),
	logoSize: num(190, 'Logo size in design units', 20, 600),
	headlineSize: num(96, 'Headline size in design units', 10, 300),
	ctaSize: num(56, 'Button text size in design units', 10, 200),
	x: num(0.5, 'Horizontal centre (fraction of width)', 0, 1),
	y: num(0.5, 'Vertical centre (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const Star: React.FC<{fill: number; size: number; color: string}> = ({fill, size, color}) => {
	const id = `st${Math.round(fill * 100)}`;
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" style={{display: 'block'}}>
			<defs>
				<linearGradient id={id}>
					<stop offset={`${fill * 100}%`} stopColor={color} />
					<stop offset={`${fill * 100}%`} stopColor="rgba(255,255,255,0.25)" />
				</linearGradient>
			</defs>
			<path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" fill={`url(#${id})`} />
		</svg>
	);
};

const EndCard: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, font2, landscape, Ds} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const rich = useMemo(() => parseRich(p.headline), [p.headline]);
	const logoIn = sp(frame, fps, 0.05, {damping: 11, stiffness: 170, mass: 0.8});
	const ctaStart = 0.25 + rich.words.length * 0.05 + 0.35;
	const ctaIn = sp(frame, fps, ctaStart, {damping: 12, stiffness: 170, mass: 0.9});
	const subE = ease.outExpo(prog(t, ctaStart + 0.3, ctaStart + 1.0));
	const pulse = t > ctaStart + 0.6 ? 1 + 0.03 * breathe(t - ctaStart, 1.4) : 1;
	const ping = t > ctaStart + 0.7 ? ((t - ctaStart - 0.7) % 1.4) / 1.4 : 0;
	const shine = shineProgress(t, ctaStart + 0.55, 2.2, 0.8);
	const float = Math.sin(t * 1.5) * 5 * u;
	const ls = p.logoSize * u;
	const ink = onColor(theme.accent);
	const drift = map(t, [0, Ds], [0, 1]);
	const nameStyle: React.CSSProperties = {...fontCss(font, {weight: Math.max(800, font.weight)}), fontSize: ls * 0.42, color: theme.fg, letterSpacing: '-0.02em', textShadow: liftShadow(u, 0.35)};
	return (
		<AbsoluteFill>
			<div style={{position: 'absolute', left: p.x * W, top: p.y * H, width: 'max-content', transform: `translate(-50%, -50%) scale(${1 + 0.02 * drift})`}}>
				<FitBox maxWidth={W * 0.92} maxHeight={H * 0.9}>
					<div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', width: landscape ? W * 0.62 : Math.min(W * 0.88, 980 * u), textAlign: 'center'}}>
						{/* logo */}
						<div style={{display: 'flex', flexDirection: p.showName === 'right' ? 'row' : 'column', alignItems: 'center', gap: 26 * u, transform: `translateY(${float}px)`}}>
							<div style={{position: 'relative', width: ls, height: ls, opacity: Math.min(1, logoIn * 1.5), transform: `scale(${0.55 + 0.45 * logoIn})`}}>
								<GlowBlob x={ls / 2} y={ls / 2} w={ls * 2.8} h={ls * 2.8} color={theme.glow} opacity={0.3 + 0.1 * breathe(t, 2.6)} />
								<Logo src={p.logo} name={p.name} size={ls} shape="app" theme={theme} font={font}>
									<ShineBand p={shineProgress(t, 0.6, 3.0, 0.8)} opacity={0.5} width={0.35} />
								</Logo>
							</div>
							{p.showName !== 'none' && p.name ? <div style={{...nameStyle, opacity: ease.outCubic(prog(t, 0.2, 0.7))}}>{p.name}</div> : null}
						</div>
						{/* headline */}
						<div
							style={{
								...fontCss(font),
								fontSize: p.headlineSize * u,
								lineHeight: 1.06,
								letterSpacing: '-0.02em',
								marginTop: 54 * u,
								textWrap: 'balance',
								color: theme.fg,
								textShadow: liftShadow(u, 0.35),
							} as React.CSSProperties}
						>
							{rich.lines.map((line, li) => (
								<div key={li}>
									{line.map((w, wi) => {
										const s0 = 0.25 + w.index * 0.05;
										const e = ease.outExpo(prog(t, s0, s0 + 0.75));
										return (
											<React.Fragment key={wi}>
												{wi > 0 ? ' ' : null}
												<span
													style={{
														display: 'inline-block',
														opacity: e,
														transform: `translateY(${(1 - e) * 0.5}em)`,
														filter: e < 0.95 ? `blur(${(1 - e) * 8 * u}px)` : undefined,
														textShadow: w.accent ? `${glowShadow(theme.accent, 0.45, u)}, ${liftShadow(u, 0.35)}` : undefined,
													}}
												>
													<Segs word={w} fg={theme.fg} accent={theme.accent} font2={font2} />
												</span>
											</React.Fragment>
										);
									})}
								</div>
							))}
						</div>
						{/* CTA */}
						{p.cta ? (
							<div style={{position: 'relative', marginTop: 60 * u, opacity: Math.min(1, ctaIn * 1.5), transform: `translateY(${(1 - ctaIn) * 70 * u}px) scale(${(0.8 + 0.2 * ctaIn) * pulse})`}}>
								<PingRing p={ping} color={theme.accent} radius={200 * u} spread={26 * u} width={4 * u} />
								<div
									style={{
										position: 'relative',
										overflow: 'hidden',
										display: 'flex',
										alignItems: 'center',
										gap: 18 * u,
										padding: `${28 * u}px ${58 * u}px`,
										borderRadius: 200 * u,
										background: `linear-gradient(180deg, ${theme.accent}, ${theme.accent})`,
										boxShadow: `0 ${16 * u}px ${40 * u}px rgba(0,0,0,0.35), 0 0 ${40 * u}px ${rgba(theme.accent, 0.45 + 0.15 * breathe(t, 1.4))}, inset 0 ${2 * u}px 0 rgba(255,255,255,0.45)`,
									}}
								>
									<span style={{...fontCss(font, {weight: 800}), fontSize: p.ctaSize * u, color: ink, letterSpacing: '-0.01em', whiteSpace: 'nowrap'}}>{p.cta}</span>
									{p.ctaIcon !== 'none' ? (
										<svg width={p.ctaSize * 0.9 * u} height={p.ctaSize * 0.9 * u} viewBox="0 0 24 24" style={{transform: `translateX(${p.ctaIcon === 'arrow' ? 4 * u * breathe(t, 1.4) : 0}px)`}}>
											{p.ctaIcon === 'arrow' ? (
												<path d="M4 12h15M13 5.5l6.5 6.5-6.5 6.5" fill="none" stroke={ink} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
											) : (
												<path d="M12 3.5v12M6 10l6 6 6-6M5 20.5h14" fill="none" stroke={ink} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
											)}
										</svg>
									) : null}
									<ShineBand p={shine} opacity={0.7} width={0.3} />
								</div>
							</div>
						) : null}
						{/* subline + rating */}
						{p.subline || p.rating > 0 ? (
							<div
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: 14 * u,
									marginTop: 30 * u,
									opacity: subE,
									transform: `translateY(${(1 - subE) * 20 * u}px)`,
									...fontCss(font, {weight: 600}),
									fontSize: 36 * u,
									color: theme.muted,
									textShadow: liftShadow(u, 0.3),
								}}
							>
								{p.rating > 0 ? (
									<div style={{display: 'flex', gap: 4 * u}}>
										{[0, 1, 2, 3, 4].map((i) => {
											const pop = sp(frame, fps, ctaStart + 0.4 + i * 0.07, {damping: 10, stiffness: 240, mass: 0.6});
											return (
												<div key={i} style={{transform: `scale(${pop})`}}>
													<Star fill={Math.max(0, Math.min(1, p.rating - i))} size={38 * u} color="#FFC94D" />
												</div>
											);
										})}
									</div>
								) : null}
								{p.rating > 0 ? <span style={{color: theme.fg}}>{p.rating.toFixed(1)}</span> : null}
								{p.subline ? <span>{p.rating > 0 ? `· ${p.subline}` : p.subline}</span> : null}
							</div>
						) : null}
					</div>
				</FitBox>
			</div>
		</AbsoluteFill>
	);
};

export const endCard = defineLook({
	id: 'end-card',
	category: 'brand',
	kind: 'overlay',
	duration: 4,
	outro: 0,
	description: 'End card: logo pops in on a breathing glow, headline words rise in, CTA pill springs up then pulses with a radar ping and a recurring shine sweep; optional star rating + App-Store-style subline.',
	weights: [600, 800],
	props,
	render: EndCard,
});
