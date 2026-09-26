import React, {useMemo} from 'react';
import {AbsoluteFill, Img, useCurrentFrame} from 'remotion';
import {breathe, ease, formatNumber, lerp, map, prog, resolveDecimals, sp, type NumberFormat} from '../lib/anim';
import {glowShadow, liftShadow, mix, rgba} from '../lib/color';
import {EMOJI_STACK, fontCss} from '../lib/fonts';
import {assetSrc, defineLook, useLook, type LookProps} from '../lib/look';
import {parseRich} from '../lib/rich';
import {int, num, oneOf, str, strList} from '../lib/schema';
import {Segs} from '../lib/text';
import {FORMATS} from './stat-counter';

const props = {
	value: num(87, 'The stat in the middle', -1e12, 1e12),
	from: num(0, 'Count-up start value', -1e12, 1e12),
	format: oneOf(FORMATS, 'percent', 'Value format (see stat-counter)'),
	decimals: int(-1, 'Decimals; -1 = automatic from value', -1, 6),
	prefix: str('', 'Value prefix'),
	suffix: str('', 'Value suffix'),
	label: str('of users found **what they needed**', 'Label under the ring (**accent**)'),
	progress: num(-1, 'Ring fill 0-1 (-1 = auto: value/100 for percent, else full)', -1, 1),
	icons: strList(['📷', '✈️', '🏨', '📄', '🗓️'], 'Orbiting icons: emoji or image paths'),
	orbitSpeed: num(0.07, 'Orbit speed in turns per second', -2, 2),
	countDuration: num(1.6, 'Seconds for the count and ring fill', 0.1, 30),
	size: num(470, 'Ring diameter (design units)', 100, 1200),
	y: num(0.46, 'Vertical centre of the ring (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const StatOrbit: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, font2, Ds} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const D = p.size * u;
	const R = D / 2;
	const cx = W / 2;
	const cy = p.y * H;
	const stroke = 20 * u;
	const fill = p.progress >= 0 ? p.progress : p.format === 'percent' ? Math.max(0, Math.min(1, p.value / 100)) : 1;
	const c = ease.outExpo(prog(t, 0.3, 0.3 + p.countDuration));
	const inS = sp(frame, fps, 0.05, {damping: 14, stiffness: 150});
	const dec = resolveDecimals(p.decimals, p.value, p.format as NumberFormat);
	const text = formatNumber(lerp(p.from, p.value, c), {format: p.format as NumberFormat, decimals: dec, prefix: p.prefix, suffix: p.suffix});
	const C = 2 * Math.PI * (R - stroke / 2);
	const rich = useMemo(() => parseRich(p.label), [p.label]);
	const labelE = ease.outExpo(prog(t, 0.6, 1.4));
	const rx = R * 1.5;
	const ry = R * 0.52;
	const tilt = -14;
	const icons = p.icons.slice(0, 10);
	const orbitIn = ease.outCubic(prog(t, 0.2, 1.1));
	const landed = t > 0.3 + p.countDuration * 0.9;
	const flash = landed ? Math.exp(-(t - (0.3 + p.countDuration * 0.9)) / 0.4) : 0;
	const drift = map(t, [0, Ds], [0, 1]);
	const iconEls = icons.map((ic, k) => {
		const th = (k / icons.length) * Math.PI * 2 + t * p.orbitSpeed * Math.PI * 2 + 0.4;
		const ex = Math.cos(th) * rx * orbitIn;
		const ey = Math.sin(th) * ry * orbitIn;
		const tr = (tilt * Math.PI) / 180;
		const x = cx + ex * Math.cos(tr) - ey * Math.sin(tr);
		const y = cy + ex * Math.sin(tr) + ey * Math.cos(tr);
		const z = Math.sin(th); // >0 front
		const s = 104 * u * (0.74 + 0.32 * (z + 1) / 2);
		const isImg = /[/.]/.test(ic);
		return {
			front: z > 0,
			el: (
				<div
					key={k}
					style={{
						position: 'absolute',
						left: x - s / 2,
						top: y - s / 2,
						width: s,
						height: s,
						borderRadius: '50%',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						background: `linear-gradient(160deg, ${rgba(mix(theme.bg, '#FFFFFF', 0.28), 0.9)}, ${rgba(mix(theme.bg, '#FFFFFF', 0.1), 0.9)})`,
						border: `${2 * u}px solid ${rgba('#FFFFFF', 0.18)}`,
						boxShadow: `0 ${8 * u}px ${20 * u}px rgba(0,0,0,0.35), 0 0 ${18 * u}px ${rgba(theme.accent, 0.25 * (z + 1) / 2)}`,
						opacity: (0.62 + 0.38 * (z + 1) / 2) * orbitIn,
						fontFamily: EMOJI_STACK,
						fontSize: s * 0.52,
						overflow: 'hidden',
					}}
				>
					{isImg ? <Img src={assetSrc(ic)} style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : ic}
				</div>
			),
		};
	});
	return (
		<AbsoluteFill style={{transform: `scale(${1 + 0.02 * drift})`}}>
			{/* orbit path */}
			<svg width={W} height={H} style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
				<ellipse cx={cx} cy={cy} rx={rx * orbitIn} ry={ry * orbitIn} transform={`rotate(${tilt} ${cx} ${cy})`} fill="none" stroke={rgba(theme.fg, 0.14)} strokeWidth={2 * u} strokeDasharray={`${4 * u} ${10 * u}`} />
			</svg>
			{iconEls.filter((e) => !e.front).map((e) => e.el)}
			{/* ring */}
			<div style={{position: 'absolute', left: cx - R, top: cy - R, width: D, height: D, transform: `scale(${0.7 + 0.3 * inS})`, opacity: Math.min(1, inS * 1.5)}}>
				<div style={{position: 'absolute', inset: -R * 0.5, borderRadius: '50%', background: `radial-gradient(circle, ${rgba(theme.glow, 0.35 + 0.12 * breathe(t, 2.4) + 0.2 * flash)} 0%, transparent 62%)`}} />
				<div style={{position: 'absolute', inset: stroke * 0.8, borderRadius: '50%', background: `radial-gradient(circle at 50% 35%, ${rgba(mix(theme.bg, '#FFFFFF', 0.12), 0.9)}, ${rgba(theme.bg, 0.85)})`, boxShadow: `inset 0 ${2 * u}px 0 ${rgba('#FFFFFF', 0.1)}`}} />
				<svg width={D} height={D} style={{position: 'absolute', inset: 0, overflow: 'visible', transform: 'rotate(-90deg)'}}>
					<defs>
						<linearGradient id="sog" x1="0" y1="0" x2="1" y2="1">
							<stop offset="0%" stopColor={theme.accent2} />
							<stop offset="100%" stopColor={theme.accent} />
						</linearGradient>
						<filter id="soblur" x="-30%" y="-30%" width="160%" height="160%">
							<feGaussianBlur stdDeviation={8 * u} />
						</filter>
					</defs>
					<circle cx={R} cy={R} r={R - stroke / 2} fill="none" stroke={rgba(theme.fg, 0.1)} strokeWidth={stroke} />
					<circle cx={R} cy={R} r={R - stroke / 2} fill="none" stroke="url(#sog)" strokeWidth={stroke * 1.6} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - fill * c)} opacity={0.5} filter="url(#soblur)" />
					<circle cx={R} cy={R} r={R - stroke / 2} fill="none" stroke="url(#sog)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - fill * c)} />
				</svg>
				<div
					style={{
						position: 'absolute',
						inset: 0,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						...fontCss(font, {weight: Math.max(800, font.weight)}),
						fontSize: D * 0.27,
						letterSpacing: '-0.03em',
						fontVariantNumeric: 'tabular-nums',
						color: theme.fg,
						textShadow: `${glowShadow(theme.glow, 0.5 + 0.8 * flash, u)}, ${liftShadow(u, 0.35)}`,
						transform: `scale(${1 + 0.06 * flash})`,
					}}
				>
					{text}
				</div>
			</div>
			{iconEls.filter((e) => e.front).map((e) => e.el)}
			{p.label ? (
				<div
					style={{
						position: 'absolute',
						left: W * 0.08,
						right: W * 0.08,
						top: cy + R + ry * 0.9 + 40 * u,
						textAlign: 'center',
						...fontCss(font, {weight: 700}),
						fontSize: 52 * u,
						lineHeight: 1.15,
						color: theme.fg,
						opacity: labelE,
						transform: `translateY(${(1 - labelE) * 26 * u}px)`,
						textShadow: liftShadow(u, 0.35),
						textWrap: 'balance',
					} as React.CSSProperties}
				>
					{rich.words.map((w, i) => (
						<React.Fragment key={i}>
							{i > 0 ? ' ' : null}
							<Segs word={w} fg={theme.fg} accent={theme.accent} font2={font2} />
						</React.Fragment>
					))}
				</div>
			) : null}
		</AbsoluteFill>
	);
};

export const statOrbit = defineLook({
	id: 'stat-orbit',
	category: 'data',
	kind: 'overlay',
	duration: 4,
	description: 'Central stat inside a gradient progress ring that fills while the number counts up; emoji/icon bubbles orbit it on a tilted 3D ellipse (passing in front of and behind the ring); label rises in below.',
	weights: [700, 800],
	props,
	render: StatOrbit,
});
