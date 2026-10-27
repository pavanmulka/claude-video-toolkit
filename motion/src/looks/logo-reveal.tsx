import React, {useMemo} from 'react';
import {AbsoluteFill, spring, useCurrentFrame} from 'remotion';
import {clamp01, ease, lerp, prog} from '../lib/anim';
import {fontCss} from '../lib/fonts';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {Logo} from '../lib/logo';
import {measureText} from '../lib/measure';
import {MBlurDefs, mblurStyle, motionStd, type MBlur} from '../lib/motion-blur';
import {asset, num, oneOf, str} from '../lib/schema';

const props = {
	logo: asset('Logo image; empty = a simple generic mark (a dot, an open ring drawing around it, a satellite dot) that builds itself'),
	name: str('Your App', 'Wordmark text (empty = logo only)'),
	tagline: str('', 'Small line that fades up under the lockup (optional)'),
	logoSize: num(150, 'Logo size in design units', 20, 900),
	nameSize: num(112, 'Wordmark size in design units', 10, 400),
	taglineSize: num(44, 'Tagline size in design units', 8, 200),
	gap: num(34, 'Space between logo and wordmark in design units', 0, 400),
	layout: oneOf(['row', 'column'] as const, 'row', 'row = wordmark right of the logo (the logo slides aside as it reveals), column = wordmark under the logo'),
	shape: oneOf(['app', 'circle', 'none'] as const, 'none', 'Clip of an image logo: app-icon squircle, circle, or none (image as is)'),
	dotColor: str('', 'Colour of the seed dot and the generic mark\'s dots (empty = text colour)'),
	speed: num(1, 'Animation speed multiplier (2 = twice as fast)', 0.25, 4),
	x: num(0.5, 'Horizontal centre (fraction of width)', 0, 1),
	y: num(0.5, 'Vertical centre (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

// generic mark (viewBox 0..100): a seed dot grows into the core, a ring draws itself around it and a small
// satellite dot rides the ring's head and lands with a pop (deliberately plain: a brand passes its own logo)
const RING_R = 37;

const GenericMark: React.FC<{t: number; fps: number; size: number; ink: string; dot: string; T: {seed: number; shoot: number; base: number}; sp: number}> = ({t, fps, size, ink, dot, T, sp}) => {
	const seed = t < T.seed ? 0 : spring({frame: (t - T.seed) * fps * sp, fps, config: {damping: 11, stiffness: 260, mass: 0.6}});
	const draw = ease.outExpo(prog(t, T.shoot, T.shoot + 0.42 / sp));
	const land = t < T.base ? 0 : spring({frame: (t - T.base) * fps * sp, fps, config: {damping: 9, stiffness: 300, mass: 0.5}});
	const C = 2 * Math.PI * RING_R;
	const ang = -Math.PI / 2 + draw * 2 * Math.PI * 0.82;          // the ring stops short: an open orbit
	const head = {x: 50 + RING_R * Math.cos(ang), y: 50 + RING_R * Math.sin(ang)};
	const showRing = t >= T.shoot && draw > 0.005;
	return (
		<svg width={size} height={size} viewBox="0 0 100 100" style={{display: 'block', overflow: 'visible'}}>
			{showRing ? (
				<circle cx={50} cy={50} r={RING_R} fill="none" stroke={ink} strokeWidth={6.5} strokeLinecap="round"
					strokeDasharray={`${C * 0.82 * draw} ${C}`} transform="rotate(-90 50 50)" />
			) : null}
			{showRing ? <circle cx={head.x} cy={head.y} r={6.5 + 3.5 * clamp01(land)} fill={dot} /> : null}
			{seed > 0.001 ? <circle cx={50} cy={50} r={15 * Math.max(0, seed)} fill={dot} /> : null}
		</svg>
	);
};

const LogoReveal: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const sp = Math.max(0.25, p.speed);
	const row = p.layout === 'row';
	const dotC = p.dotColor || theme.fg;
	const nameStyle = useMemo<React.CSSProperties>(() => ({...fontCss(font), letterSpacing: '-0.02em', lineHeight: 1.1, whiteSpace: 'pre'}), [font]);
	const tagStyle = useMemo<React.CSSProperties>(() => ({...fontCss(font, {weight: 500}), lineHeight: 1.2, letterSpacing: '0.01em', whiteSpace: 'nowrap'}), [font]);

	// ---- sizes (shrink the whole lockup to fit 90 % of the frame)
	const chars = useMemo(() => Array.from(p.name), [p.name]);
	const geo = useMemo(() => {
		const nameW0 = p.name ? measureText(p.name, {...nameStyle, fontSize: p.nameSize * u}).width : 0;
		const tagW0 = p.tagline ? measureText(p.tagline, {...tagStyle, fontSize: p.taglineSize * u}).width : 0;
		const ls0 = p.logoSize * u;
		const gap0 = p.name ? p.gap * u : 0;
		const lockW0 = row ? ls0 + gap0 + nameW0 : Math.max(ls0, nameW0);
		const k = Math.min(1, (0.9 * W) / Math.max(1, lockW0, tagW0));
		const fs = p.nameSize * u * k;
		// letter centres (px from the wordmark's left edge) for the per-letter sweep
		const centres = chars.map((_, i) => {
			const pre = measureText(chars.slice(0, i).join(''), {...nameStyle, fontSize: fs}).width;
			const me = measureText(chars[i], {...nameStyle, fontSize: fs}).width;
			return pre + me / 2;
		});
		return {k, ls: ls0 * k, gap: gap0 * k, nameW: nameW0 * k, fs, tfs: p.taglineSize * u * k, centres};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [p.name, p.tagline, p.nameSize, p.taglineSize, p.logoSize, p.gap, row, W, u, nameStyle, tagStyle]);
	const {ls, gap, nameW, fs, tfs, centres} = geo;
	const nameH = p.name ? fs * 1.1 : 0;
	const tagH = p.tagline ? tfs * 1.2 : 0;
	const tagGap = p.tagline ? tfs * 0.9 : 0;

	// ---- timeline
	const T = {seed: 0.12 / sp, shoot: 0.32 / sp, base: 0.5 / sp};
	const NAME0 = (p.logo ? 0.8 : 0.82) / sp;
	const NAMED = Math.min(1.1, Math.max(0.5, 0.06 * chars.length + 0.25)) / sp;
	const SHIFT = 0.62 / sp;
	const shift = (tt: number) => (p.name ? ease.outQuart(prog(tt, NAME0, NAME0 + SHIFT)) : 0);

	// ---- layout: the lockup is centred on (x, y); the logo starts centred alone and makes room for the wordmark
	const cx = p.x * W;
	const lockH = row ? Math.max(ls, nameH) : ls + gap + nameH;
	const cy = p.y * H - (tagH + tagGap) / 2;
	const logoPos = (tt: number) => {
		const e = shift(tt);
		if (row) return {x: lerp(cx, cx - (ls + gap + nameW) / 2 + ls / 2, e), y: cy};
		return {x: cx, y: lerp(cy, cy - lockH / 2 + ls / 2, e)};
	};
	const lp = logoPos(t);
	const lpPrev = logoPos(t - 0.5 / fps);
	const logoBlur: MBlur = {id: 'lrev-logo', sx: motionStd(lp.x - lpPrev.x, 0.6, 40 * u), sy: motionStd(lp.y - lpPrev.y, 0.6, 40 * u), w: ls, h: ls};

	// image logo: grows out of the seed dot (circular clip) with a slight scale settle
	const seed = t < T.seed ? 0 : spring({frame: (t - T.seed) * fps * sp, fps, config: {damping: 11, stiffness: 260, mass: 0.6}});
	const clipE = ease.outExpo(prog(t, T.shoot, T.shoot + 0.5 / sp));
	const settle = t < T.shoot ? 0 : spring({frame: (t - T.shoot) * fps * sp, fps, config: {damping: 12, stiffness: 170, mass: 0.8}});
	const dotR = ls * 0.06;
	const clipR = lerp((dotR / ls) * 100, 72, clipE);

	// ---- wordmark sweep: a feathered mask edge runs left -> right; letters slide + de-blur as it passes
	const feather = fs * 1.1;
	const sweep = ease.outCubic(prog(t, NAME0 + 0.06 / sp, NAME0 + 0.06 / sp + NAMED));
	const edge = sweep * (nameW + feather * 1.6);
	const nameLeft = row ? lp.x + ls / 2 + gap : cx - nameW / 2;
	const nameTop = row ? lp.y - nameH / 2 : lp.y + ls / 2 + gap;
	const letterBlurs: MBlur[] = [];
	const letters = chars.map((ch, i) => {
		const q = clamp01((edge - centres[i]) / (feather * 1.25));
		const e = ease.outCubic(q);
		const b: MBlur = {id: `lrev-l${i}`, sx: (1 - e) * 14 * u, sy: (1 - e) * 1.5 * u, w: fs * 0.6, h: fs * 1.1};
		letterBlurs.push(b);
		return (
			<span
				key={i}
				style={{
					display: 'inline-block',
					whiteSpace: 'pre',
					transform: `translateX(${(1 - e) * 0.32 * fs}px)`,
					opacity: clamp01(q * 1.6),
					...mblurStyle(b),
				}}
			>
				{ch}
			</span>
		);
	});
	const tagE = ease.outExpo(prog(t, NAME0 + NAMED * 0.65, NAME0 + NAMED * 0.65 + 0.7 / sp));

	return (
		<AbsoluteFill>
			<MBlurDefs blurs={[logoBlur, ...letterBlurs]} />
			{/* logo */}
			<div style={{position: 'absolute', left: lp.x - ls / 2, top: lp.y - ls / 2, width: ls, height: ls, ...mblurStyle(logoBlur)}}>
				{p.logo ? (
					<>
						<div
							style={{
								position: 'absolute',
								inset: 0,
								clipPath: `circle(${clipR.toFixed(3)}% at 50% 50%)`,
								transform: `scale(${t < T.shoot ? 0.6 : 0.82 + 0.18 * settle})`,
								opacity: t < T.shoot ? 0 : 1,
							}}
						>
							<Logo src={p.logo} name={p.name} size={ls} shape={p.shape} theme={theme} font={font} shadow={false} />
						</div>
						{seed > 0.001 && clipE < 0.5 ? (
							<div
								style={{
									position: 'absolute',
									left: ls / 2 - dotR,
									top: ls / 2 - dotR,
									width: dotR * 2,
									height: dotR * 2,
									borderRadius: '50%',
									background: dotC,
									transform: `scale(${Math.max(0, seed) * (1 + 1.5 * clipE)})`,
									opacity: 1 - prog(clipE, 0.1, 0.5),
								}}
							/>
						) : null}
					</>
				) : (
					<div style={{width: ls, height: ls, transform: `scale(${t < T.shoot ? 1 : 0.92 + 0.08 * settle})`}}>
						<GenericMark t={t} fps={fps} size={ls} ink={theme.fg} dot={dotC} T={T} sp={sp} />
					</div>
				)}
			</div>
			{/* wordmark */}
			{p.name && edge > 0 ? (
				<div
					style={{
						position: 'absolute',
						left: nameLeft,
						top: nameTop,
						width: nameW + fs,
						height: nameH,
						...nameStyle,
						fontSize: fs,
						color: theme.fg,
						WebkitMaskImage: `linear-gradient(90deg, #000 ${Math.max(0, edge - feather)}px, transparent ${edge}px)`,
						maskImage: `linear-gradient(90deg, #000 ${Math.max(0, edge - feather)}px, transparent ${edge}px)`,
					}}
				>
					{letters}
				</div>
			) : null}
			{/* tagline */}
			{p.tagline && tagE > 0 ? (
				<div
					style={{
						position: 'absolute',
						left: cx,
						top: cy + lockH / 2 + tagGap,
						transform: `translate(-50%, ${(1 - tagE) * 0.6 * tfs}px)`,
						...tagStyle,
						fontSize: tfs,
						color: theme.muted,
						opacity: tagE,
						filter: tagE < 0.97 ? `blur(${(1 - tagE) * 6 * u}px)` : undefined,
					}}
				>
					{p.tagline}
				</div>
			) : null}
		</AbsoluteFill>
	);
};

export const logoReveal = defineLook({
	id: 'logo-reveal',
	category: 'brand',
	kind: 'overlay',
	duration: 3,
	font: {weight: 700},
	usesFont2: false,
	weights: [500],
	description:
		'Clean logo build: a dot appears, the logo grows out of it (circular reveal + slight scale settle; without a logo a generic dot-and-ring mark draws itself), then the logo slides aside while the wordmark reveals left to right behind a feathered mask with a little slide + blur per letter; optional tagline fades up below.',
	props,
	render: LogoReveal,
});
