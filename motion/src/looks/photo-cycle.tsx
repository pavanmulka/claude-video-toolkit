import React from 'react';
import {AbsoluteFill, Easing, Img, useCurrentFrame} from 'remotion';
import {z} from 'zod';
import {ease, prog} from '../lib/anim';
import {fontCss} from '../lib/fonts';
import {assetSrc, defineLook, useLook, type LookProps} from '../lib/look';
import {asset, bool, doc, num, str} from '../lib/schema';

const itemSchema = z.object({
	image: asset('Photo; empty = a procedural gradient "photo" (4 scenes, cycled)'),
	label: str('', 'Caption under the card'),
});

const props = {
	items: doc(
		z.array(itemSchema).default([
			{image: '', label: 'Travel'},
			{image: '', label: 'Food'},
			{image: '', label: 'Sports'},
			{image: '', label: 'Fitness'},
		]),
		'Photos shown one after another, each with a caption (they loop when the look runs longer)',
	),
	interval: num(0.55, 'Seconds per photo (hard swap with a one-frame bump)', 0.05, 30),
	grow: num(0.5, 'Seconds the card takes to grow from a point (fast expo-style ease)', 0.05, 5),
	cardWidth: num(0.62, 'Card width as a fraction of the frame width (shrunk to fit short frames)', 0.05, 1),
	aspect: num(0.68, 'Card height / width', 0.2, 3),
	radius: num(0, 'Photo corner radius (design units; 0 = square corners)', 0, 400),
	handles: bool(true, 'Two small square selection handles at the top-right and bottom-left corners; they lead the grow and the shrink'),
	handleColor: str('', 'Handle colour; empty = theme fg'),
	handleSize: num(14, 'Handle size (design units)', 2, 80),
	labelSize: num(40, 'Caption size (design units; 0 = no caption)', 0, 300),
	labelColor: str('', 'Caption colour; empty = theme fg'),
	labelGap: num(16, 'Gap between the card and the caption (design units)', 0, 200),
	shadow: num(0, 'Card drop shadow strength (0 = flat like a design canvas, 1 = soft lift)', 0, 1),
	x: num(0.5, 'Card centre x (fraction of width)', -0.5, 1.5),
	y: num(0.45, 'Card centre y (fraction of height)', -0.5, 1.5),
};

type P = LookProps<typeof props>;

const GROW = Easing.bezier(0.7, 0, 0.18, 1);
const SHRINK = Easing.bezier(0.45, 0, 0.2, 1);

/** Procedural "photos": soft gradients + simple shapes (no external images). */
const Scene: React.FC<{k: number}> = ({k}) => {
	const id = `pc-scene-${k}`;
	const common = (
		<>
			<radialGradient id={`${id}-light`} cx="30%" cy="20%" r="80%">
				<stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.35} />
				<stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
			</radialGradient>
			<radialGradient id={`${id}-vig`} cx="50%" cy="50%" r="75%">
				<stop offset="60%" stopColor="#000000" stopOpacity={0} />
				<stop offset="100%" stopColor="#000000" stopOpacity={0.28} />
			</radialGradient>
		</>
	);
	const overlay = (
		<>
			<rect width="160" height="108" fill={`url(#${id}-light)`} />
			<rect width="160" height="108" fill={`url(#${id}-vig)`} />
		</>
	);
	const svg = (defs: React.ReactNode, body: React.ReactNode) => (
		<svg viewBox="0 0 160 108" preserveAspectRatio="xMidYMid slice" style={{width: '100%', height: '100%', display: 'block'}}>
			<defs>
				{common}
				{defs}
			</defs>
			{body}
			{overlay}
		</svg>
	);
	switch (k % 4) {
		case 0: // travel: sky, sun, mountains, lake
			return svg(
				<linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stopColor="#7FB8F5" />
					<stop offset="70%" stopColor="#FFD2A6" />
					<stop offset="100%" stopColor="#FFB98A" />
				</linearGradient>,
				<>
					<rect width="160" height="108" fill={`url(#${id}-sky)`} />
					<circle cx="112" cy="44" r="13" fill="#FFF4CF" />
					<circle cx="112" cy="44" r="20" fill="#FFF4CF" opacity={0.3} />
					<polygon points="-10,90 38,36 70,72 92,52 140,96 -10,108" fill="#5E6FA3" />
					<polygon points="40,108 96,58 124,80 140,68 175,108" fill="#3E4C7E" />
					<polygon points="38,36 46,45 30,45" fill="#F2F4FF" opacity={0.85} />
					<rect y="92" width="160" height="16" fill="#2F3B66" />
					<rect y="94" width="160" height="2" fill="#FFD2A6" opacity={0.35} />
				</>,
			);
		case 1: // food: warm table, plate, food
			return svg(
				<linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
					<stop offset="0%" stopColor="#FFC98F" />
					<stop offset="100%" stopColor="#F07A4F" />
				</linearGradient>,
				<>
					<rect width="160" height="108" fill={`url(#${id}-bg)`} />
					<ellipse cx="82" cy="62" rx="50" ry="36" fill="#000000" opacity={0.12} />
					<ellipse cx="80" cy="56" rx="48" ry="35" fill="#FFFFFF" />
					<ellipse cx="80" cy="56" rx="36" ry="26" fill="#F3EFEA" />
					<circle cx="68" cy="52" r="10" fill="#7CC36B" />
					<circle cx="88" cy="50" r="9" fill="#E8503F" />
					<circle cx="80" cy="64" r="8" fill="#FFC53D" />
					<circle cx="94" cy="62" r="5" fill="#7CC36B" />
					<rect x="134" y="20" width="5" height="70" rx="2.5" fill="#E9E2D8" />
					<rect x="20" y="22" width="4" height="66" rx="2" fill="#E9E2D8" />
				</>,
			);
		case 2: // sports: pitch lines and a ball
			return svg(
				<linearGradient id={`${id}-bg`} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stopColor="#4CC06B" />
					<stop offset="100%" stopColor="#23874A" />
				</linearGradient>,
				<>
					<rect width="160" height="108" fill={`url(#${id}-bg)`} />
					{[0, 1, 2, 3, 4].map((s) => (
						<rect key={s} x={s * 40 - 10} width="20" height="108" fill="#FFFFFF" opacity={0.05} />
					))}
					<line x1="80" y1="0" x2="80" y2="108" stroke="#FFFFFF" strokeWidth="1.6" opacity={0.75} />
					<circle cx="80" cy="54" r="24" fill="none" stroke="#FFFFFF" strokeWidth="1.6" opacity={0.75} />
					<ellipse cx="104" cy="82" rx="12" ry="3.5" fill="#000000" opacity={0.2} />
					<circle cx="102" cy="70" r="12" fill="#FFFFFF" />
					<polygon points="102,64 107,68 105,74 99,74 97,68" fill="#1E1E24" />
					<circle cx="102" cy="70" r="12" fill="none" stroke="#C9CCD3" strokeWidth="0.8" />
				</>,
			);
		default: // fitness: gradient studio, dumbbell
			return svg(
				<linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
					<stop offset="0%" stopColor="#B49BFF" />
					<stop offset="100%" stopColor="#FF7FB5" />
				</linearGradient>,
				<>
					<rect width="160" height="108" fill={`url(#${id}-bg)`} />
					<rect y="78" width="160" height="30" fill="#000000" opacity={0.1} />
					<ellipse cx="80" cy="82" rx="46" ry="5" fill="#000000" opacity={0.18} />
					<rect x="52" y="54" width="56" height="7" rx="3.5" fill="#3A3150" />
					<rect x="38" y="38" width="12" height="40" rx="4" fill="#2A2340" />
					<rect x="110" y="38" width="12" height="40" rx="4" fill="#2A2340" />
					<rect x="49" y="44" width="7" height="28" rx="3" fill="#3A3150" />
					<rect x="104" y="44" width="7" height="28" rx="3" fill="#3A3150" />
					<rect x="40" y="40" width="3" height="36" rx="1.5" fill="#FFFFFF" opacity={0.25} />
				</>,
			);
	}
};

const PhotoCycle: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, Ds, outro} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const items = p.items.length ? p.items : [{image: '', label: ''}];
	const n = items.length;
	const hasLabel = p.labelSize > 0 && items.some((it) => it.label);
	const labelBlock = hasLabel ? p.labelGap * u + p.labelSize * u * 1.3 : 0;
	// card size: width fraction, shrunk so card + caption fit 82 % of the height
	let cw = p.cardWidth * W;
	let ch = cw * p.aspect;
	const maxH = H * 0.82 - labelBlock;
	if (ch > maxH) {
		cw *= maxH / ch;
		ch = maxH;
	}
	const cx = p.x * W;
	const cy = p.y * H;

	// grow (handles lead), cycle, shrink (custom outro: the rect collapses, the two handles meet last)
	const outS = Math.min(outro, Ds * 0.5);
	const scaleAt = (tt: number) => {
		const ex = outS > 0 ? prog(tt, Ds - outS, Ds - 1 / fps) : 0;
		const r = GROW(prog(tt, p.grow * 0.08, p.grow)) * (1 - SHRINK(prog(ex, 0, 0.8)));
		const h = GROW(prog(tt, 0, p.grow * 0.86)) * (1 - SHRINK(prog(ex, 0.08, 0.94)));
		return {r, h, ex};
	};
	const {r: sR, h: sH, ex} = scaleAt(t);
	const handlesOn = outS === 0 || ex < 0.999;

	const k = Math.max(0, Math.floor((t - p.grow) / p.interval));
	const idx = k % n;
	const swapFrame = Math.round((p.grow + k * p.interval) * fps);
	const since = frame - swapFrame;
	const bump = k > 0 && since >= 0 ? (since === 0 ? 1.035 : since === 1 ? 1.012 : 1) : 1;
	const item = items[idx];
	// a little blur while the scale moves fast
	const prevT = Math.max(0, t - 1 / fps);
	const sPrev = scaleAt(prevT).r;
	const scaleBlur = Math.min(10 * u, Math.abs(sR - sPrev) * 0.12 * Math.max(cw, ch) * 0.25);
	const labelIn = ease.outExpo(prog(t, p.grow * 0.75, p.grow * 0.75 + 0.3));
	const hc = p.handleColor || theme.fg;
	const hs = p.handleSize * u;
	const off = hs * 0.35;
	const handle = (sx: number, sy: number) => {
		const hx = cx + sx * ((cw / 2) * sH + off);
		const hy = cy + sy * ((ch / 2) * sH + off);
		return <div style={{position: 'absolute', left: hx - hs / 2, top: hy - hs / 2, width: hs, height: hs, background: hc}} />;
	};
	return (
		<AbsoluteFill>
			{sR > 0.002 ? (
				<div
					style={{
						position: 'absolute',
						left: cx - cw / 2,
						top: cy - ch / 2,
						width: cw,
						transform: `scale(${(sR * bump).toFixed(4)})`,
						transformOrigin: `${cw / 2}px ${ch / 2}px`,
						filter: scaleBlur > 0.4 ? `blur(${scaleBlur.toFixed(2)}px)` : undefined,
					}}
				>
					<div
						style={{
							width: cw,
							height: ch,
							borderRadius: p.radius * u,
							overflow: 'hidden',
							background: '#D9D9DE',
							boxShadow: p.shadow > 0 ? `0 ${14 * u * p.shadow}px ${40 * u * p.shadow}px rgba(0,0,0,${0.25 * p.shadow})` : undefined,
						}}
					>
						{item.image ? <Img src={assetSrc(item.image)} style={{width: '100%', height: '100%', objectFit: 'cover', display: 'block'}} /> : <Scene k={idx} />}
					</div>
					{hasLabel && item.label ? (
						<div
							style={{
								marginTop: p.labelGap * u,
								width: cw,
								textAlign: 'center',
								...fontCss(font, {weight: Math.min(font.weight, 600)}),
								fontSize: p.labelSize * u,
								lineHeight: 1.2,
								color: p.labelColor || theme.fg,
								opacity: labelIn,
								transform: `translateY(${(1 - labelIn) * 10 * u}px)`,
								whiteSpace: 'nowrap',
							}}
						>
							{item.label}
						</div>
					) : null}
				</div>
			) : null}
			{p.handles && handlesOn ? (
				<>
					{handle(1, -1)}
					{handle(-1, 1)}
				</>
			) : null}
		</AbsoluteFill>
	);
};

export const photoCycle = defineLook({
	id: 'photo-cycle',
	category: 'ui',
	kind: 'overlay',
	duration: 3.4,
	outro: 0.6,
	customOutro: true,
	usesFont2: false,
	weights: [600],
	description:
		'A photo card grows from a point (two square selection handles at opposite corners lead it, like a design tool), photos hard-swap every `interval` with a one-frame bump and a caption below, then it shrinks back to a point. Your photos or procedural gradient scenes.',
	props,
	render: PhotoCycle,
});
