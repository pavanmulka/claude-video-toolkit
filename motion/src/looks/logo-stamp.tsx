import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {breathe, ease, lerp, map, prog, rnd, shake, sp} from '../lib/anim';
import {liftShadow, rgba} from '../lib/color';
import {fontCss} from '../lib/fonts';
import {GlowBlob, ShineBand, Shockwave, shineProgress} from '../lib/fx';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {Logo} from '../lib/logo';
import {asset, bool, num, oneOf, str} from '../lib/schema';

const props = {
	logo: asset('Logo image; empty = monogram tile from the name'),
	name: str('Your App', 'Wordmark text (empty = logo only)'),
	tagline: str('Every trip, one place.', 'Small line under the wordmark (optional)'),
	logoSize: num(240, 'Logo size in design units', 20, 900),
	nameSize: num(116, 'Wordmark size in design units', 10, 400),
	taglineSize: num(46, 'Tagline size in design units', 8, 200),
	shape: oneOf(['app', 'circle', 'none'] as const, 'app', 'Logo clip: app-icon squircle, circle, or none (image as is)'),
	layout: oneOf(['auto', 'stack', 'row'] as const, 'auto', 'stack = logo above wordmark, row = logo left of wordmark, auto = row on landscape'),
	shine: bool(true, 'Light sweep across logo and wordmark'),
	ring: bool(true, 'Shockwave ring + particles on impact'),
	x: num(0.5, 'Horizontal centre (fraction of width)', 0, 1),
	y: num(0.5, 'Vertical centre (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const IMPACT = 0.2;

const LogoStamp: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, landscape, Ds} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const row = p.layout === 'row' || (p.layout === 'auto' && landscape);
	const ls = p.logoSize * u;
	// stamp: fast ease-in drop from big, then squash + spring settle
	const drop = prog(t, 0.02, IMPACT, ease.inCubic);
	const settle = sp(frame, fps, IMPACT, {damping: 8, stiffness: 260, mass: 0.7});
	const squash = t >= IMPACT ? Math.sin(Math.min(1, settle) * Math.PI) * Math.max(0, 1 - (t - IMPACT) / 0.5) : 0;
	const scale = t < IMPACT ? lerp(2.6, 1, drop) : 1 + (settle - 1) * 0.35;
	const sx = scale * (1 + 0.09 * squash);
	const sy = scale * (1 - 0.1 * squash);
	const logoOpacity = prog(t, 0.02, 0.12);
	const blur = t < IMPACT ? (1 - drop) * 18 * u : 0;
	const sh = shake(t, [IMPACT], 9 * u, 'stamp');
	const float = Math.sin(t * 1.6) * 5 * u * prog(t, 0.8, 1.4);
	const nameChars = Array.from(p.name);
	const nameStart = 0.45;
	const tagE = ease.outExpo(prog(t, 0.8, 1.6));
	const shineP = p.shine ? shineProgress(t, 0.95, 2.4, 0.8) : 0;
	const nameShine = p.shine ? shineProgress(t, nameStart + nameChars.length * 0.03 + 0.55, 2.4, 0.9) : 0;
	const glowB = breathe(t, 2.8);
	const drift = map(t, [0, Ds], [0, 1]);
	const particles =
		p.ring && t > IMPACT
			? Array.from({length: 16}, (_, i) => {
					const lt = t - IMPACT;
					const life = rnd(`lp${i}`, 0.45, 0.8);
					if (lt > life) return null;
					const a = (i / 16) * Math.PI * 2 + rnd(`la${i}`, -0.2, 0.2);
					const d = ls * 0.55 + ease.outCubic(lt / life) * ls * rnd(`ld${i}`, 0.45, 0.9);
					const s = rnd(`ls${i}`, 5, 11) * u * (1 - lt / life);
					return (
						<div
							key={i}
							style={{
								position: 'absolute',
								left: Math.cos(a) * d - s / 2,
								top: Math.sin(a) * d - s / 2,
								width: s,
								height: s,
								borderRadius: '50%',
								background: i % 3 ? theme.accent : theme.fg,
								opacity: 1 - lt / life,
								boxShadow: `0 0 ${8 * u}px ${rgba(theme.accent, 0.8)}`,
							}}
						/>
					);
				})
			: null;
	return (
		<AbsoluteFill>
			<div
				style={{
					position: 'absolute',
					left: p.x * W,
					top: p.y * H,
					transform: `translate(-50%, -50%) translate(${sh.x}px, ${sh.y}px) scale(${1 + 0.03 * drift})`,
					width: 'max-content',
					display: 'flex',
					flexDirection: row ? 'row' : 'column',
					alignItems: 'center',
					gap: row ? 48 * u : 40 * u,
				}}
			>
				<div style={{position: 'relative', width: ls, height: ls, transform: `translateY(${float}px)`}}>
					<GlowBlob x={ls / 2} y={ls / 2} w={ls * 2.6} h={ls * 2.6} color={theme.glow} opacity={(0.32 + 0.12 * glowB) * logoOpacity} />
					{p.ring ? (
						<div style={{position: 'absolute', left: ls / 2, top: ls / 2, width: 0, height: 0}}>
							<Shockwave t={t} t0={IMPACT} cx={0} cy={0} W={0} H={0} u={u} r0={ls * 0.55} reach={ls * 1.6} color={theme.accent} width={10} flash={0.45} />
							{particles}
						</div>
					) : null}
					<div style={{position: 'absolute', inset: 0, opacity: logoOpacity, transform: `scale(${sx}, ${sy})`, filter: blur > 0.4 ? `blur(${blur}px)` : undefined}}>
						<Logo src={p.logo} name={p.name} size={ls} shape={p.shape} theme={theme} font={font}>
							<ShineBand p={shineP} opacity={0.6} width={0.35} />
						</Logo>
					</div>
				</div>
				{p.name || p.tagline ? (
					<div style={{display: 'flex', flexDirection: 'column', alignItems: row ? 'flex-start' : 'center', textAlign: row ? 'left' : 'center'}}>
						{p.name ? (
							<div
								style={{
									...fontCss(font, {weight: Math.max(font.weight, 800)}),
									fontSize: p.nameSize * u,
									lineHeight: 1.05,
									letterSpacing: '-0.025em',
									whiteSpace: 'nowrap',
									position: 'relative',
								}}
							>
								{nameChars.map((ch, i) => {
									const e = ease.outExpo(prog(t, nameStart + i * 0.03, nameStart + i * 0.03 + 0.6));
									return (
										<span
											key={i}
											style={{
												display: 'inline-block',
												whiteSpace: 'pre',
												opacity: e,
												transform: `translateY(${(1 - e) * 0.5}em)`,
												filter: e < 0.95 ? `blur(${(1 - e) * 8 * u}px)` : undefined,
												color: theme.fg,
												textShadow: liftShadow(u, 0.35),
											}}
										>
											{ch}
										</span>
									);
								})}
								{nameShine > 0 ? (
									<span
										aria-hidden
										style={{
											position: 'absolute',
											left: 0,
											top: 0,
											whiteSpace: 'pre',
											color: 'transparent',
											backgroundImage: `linear-gradient(100deg, transparent ${nameShine * 150 - 50 - 14}%, #FFFFFF ${nameShine * 150 - 50}%, ${theme.accent} ${nameShine * 150 - 50 + 7}%, transparent ${nameShine * 150 - 50 + 20}%)`,
											WebkitBackgroundClip: 'text',
											backgroundClip: 'text',
											WebkitTextFillColor: 'transparent',
										}}
									>
										{p.name}
									</span>
								) : null}
							</div>
						) : null}
						{p.tagline ? (
							<div
								style={{
									...fontCss(font, {weight: 600}),
									fontSize: p.taglineSize * u,
									lineHeight: 1.2,
									marginTop: 14 * u,
									maxWidth: row ? W * 0.5 : W * 0.84,
									color: theme.muted,
									opacity: tagE,
									letterSpacing: `${lerp(0.16, 0.01, tagE)}em`,
									textShadow: liftShadow(u, 0.3),
								}}
							>
								{p.tagline}
							</div>
						) : null}
					</div>
				) : null}
			</div>
		</AbsoluteFill>
	);
};

export const logoStamp = defineLook({
	id: 'logo-stamp',
	category: 'brand',
	kind: 'overlay',
	duration: 3,
	description: 'Logo stamps down from big (blur, squash-and-stretch, shockwave ring, particles, tiny camera shake), wordmark letters rise in, tagline tracks in; a light sweep crosses logo and wordmark while the logo floats on a breathing glow.',
	usesFont2: false,
	weights: [600, 800, 900],
	props,
	render: LogoStamp,
});
