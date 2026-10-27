import React from 'react';
import {AbsoluteFill, Easing, Img, useCurrentFrame} from 'remotion';
import {prog, rnd, sp} from '../lib/anim';
import {mix, rgba} from '../lib/color';
import {assetSrc, defineLook, useLook, type LookProps} from '../lib/look';
import {Blurred, MotionBlurDefs, motionBlur} from '../lib/motion-blur';
import {int, num, oneOf, point, strList} from '../lib/schema';

const props = {
	count: int(8, 'Number of cards', 1, 16),
	images: strList([], 'Card images (product shots, screenshots...), cycled; empty = procedural product tiles'),
	style: oneOf(['product', 'plain'] as const, 'product', 'product = white shop card (image on top, a row of stars, a price bar and a button bar); plain = just the image with rounded corners and a shadow'),
	fit: oneOf(['cover', 'contain'] as const, 'cover', 'How images fill the image area (contain = whole image on a light tile, good for cut-outs)'),
	cardWidth: num(0.25, 'Card width as a fraction of the shorter frame side', 0.05, 0.8),
	aspect: num(1, 'Image area height / width', 0.3, 3),
	radius: num(26, 'Card corner radius (design units at the default card size; scales with the card)', 0, 200),
	clear: point([0.64, 0.28], 'Centre zone kept free of cards [w, h] as fractions of the frame (for the stat / text drawn on top)'),
	x: num(0.5, 'Centre x of the clear zone (fraction of width)', 0, 1),
	y: num(0.47, 'Centre y of the clear zone (fraction of height)', 0, 1),
	colors: strList(['#FF6A2B', '#1FC6B6', '#F6C445', '#2F7BFF', '#FF4F8B', '#7C5CFF', '#2B2B33'], 'Object colours for the procedural product tiles (cycled)'),
	rotate: num(6, 'Max card rotation in degrees', 0, 45),
	stagger: num(0.06, 'Seconds between cards flying in', 0, 2),
	drift: num(1, 'Slow drift, sway and parallax after landing (0 = still)', 0, 5),
	blur: num(1, 'Motion blur on the fly-in and fly-out (0 = off)', 0, 4),
	seed: int(1, 'Random seed (another arrangement)', 0, 1e9),
};

type P = LookProps<typeof props>;
type Side = 'top' | 'right' | 'bottom' | 'left';

const EXIT = Easing.bezier(0.6, 0, 0.9, 0.4);
const STAR = 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z';

/** Simple shaded product object (sphere, bottle, box, mug, vase) in a 100x100 box. */
const ProductObject: React.FC<{k: number; col: string; id: string}> = ({k, col, id}) => {
	const light = mix(col, '#FFFFFF', 0.5);
	const dark = mix(col, '#000000', 0.28);
	const shade = (
		<linearGradient id={`${id}-h`} x1="0" y1="0" x2="1" y2="0">
			<stop offset="0%" stopColor={dark} />
			<stop offset="38%" stopColor={col} />
			<stop offset="55%" stopColor={light} />
			<stop offset="75%" stopColor={col} />
			<stop offset="100%" stopColor={dark} />
		</linearGradient>
	);
	const floor = <ellipse cx="50" cy="86" rx="27" ry="4.5" fill="#000000" opacity={0.13} />;
	let body: React.ReactNode;
	switch (k % 5) {
		case 0:
			body = (
				<>
					<radialGradient id={`${id}-r`} cx="38%" cy="34%" r="70%">
						<stop offset="0%" stopColor={light} />
						<stop offset="55%" stopColor={col} />
						<stop offset="100%" stopColor={dark} />
					</radialGradient>
					<circle cx="50" cy="54" r="29" fill={`url(#${id}-r)`} />
				</>
			);
			break;
		case 1:
			body = (
				<>
					{shade}
					<rect x="43" y="22" width="14" height="18" rx="3" fill={`url(#${id}-h)`} />
					<rect x="41" y="13" width="18" height="11" rx="2.5" fill="#2A2A30" />
					<rect x="33" y="36" width="34" height="50" rx="10" fill={`url(#${id}-h)`} />
					<rect x="33" y="54" width="34" height="15" fill="#FFFFFF" opacity={0.85} />
				</>
			);
			break;
		case 2:
			body = (
				<>
					<polygon points="22,42 36,30 80,30 66,42" fill={light} />
					<polygon points="66,42 80,30 80,72 66,84" fill={dark} />
					<rect x="22" y="42" width="44" height="42" rx="2" fill={col} />
					<rect x="40" y="42" width="8" height="42" fill="#FFFFFF" opacity={0.3} />
				</>
			);
			break;
		case 3:
			body = (
				<>
					{shade}
					<path d="M64 46 a13 13 0 1 1 0 24" fill="none" stroke={dark} strokeWidth="7" strokeLinecap="round" />
					<rect x="26" y="34" width="40" height="50" rx="8" fill={`url(#${id}-h)`} />
					<ellipse cx="46" cy="35" rx="20" ry="4" fill={dark} />
				</>
			);
			break;
		default:
			body = (
				<>
					{shade}
					<path d="M40 24 Q26 50 34 84 L66 84 Q74 50 60 24 Z" fill={`url(#${id}-h)`} />
					<ellipse cx="50" cy="24" rx="10" ry="3" fill={dark} />
				</>
			);
	}
	return (
		<svg viewBox="0 0 100 100" style={{width: '76%', height: '76%', display: 'block', overflow: 'visible'}}>
			{floor}
			{body}
		</svg>
	);
};

const ImageArea: React.FC<{p: P; i: number; w: number; h: number; r: number}> = ({p, i, w, h, r}) => {
	const img = p.images.length ? p.images[i % p.images.length] : '';
	const col = p.colors.length ? p.colors[i % p.colors.length] : '#7C5CFF';
	return (
		<div
			style={{
				width: w,
				height: h,
				borderRadius: r,
				overflow: 'hidden',
				background: img ? '#F4F4F6' : `radial-gradient(ellipse 80% 70% at 50% 40%, ${mix(col, '#FFFFFF', 0.9)} 0%, ${mix(col, '#FFFFFF', 0.8)} 100%)`,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
			}}
		>
			{img ? (
				<Img src={assetSrc(img)} style={{width: '100%', height: '100%', objectFit: p.fit, display: 'block'}} />
			) : (
				<ProductObject k={Math.floor(rnd(`fc${p.seed}:obj${i}`) * 5) + i} col={col} id={`fc-${i}`} />
			)}
		</div>
	);
};

const ProductCard: React.FC<{p: P; i: number; w: number}> = ({p, i, w}) => {
	const pad = w * 0.07;
	const iw = w - 2 * pad;
	const ih = iw * p.aspect;
	const bar = (width: number, height: number, color: string, extra: React.CSSProperties = {}) => (
		<div style={{width, height, borderRadius: height, background: color, ...extra}} />
	);
	const rating = 3 + Math.floor(rnd(`fc${p.seed}:stars${i}`) * 3);
	return (
		<div
			style={{
				width: w,
				padding: pad,
				boxSizing: 'border-box',
				background: '#FFFFFF',
				borderRadius: (p.radius * w) / 270,
				boxShadow: `0 ${w * 0.04}px ${w * 0.12}px rgba(0,0,0,0.13), 0 ${w * 0.008}px ${w * 0.025}px rgba(0,0,0,0.08)`,
			}}
		>
			<ImageArea p={p} i={i} w={iw} h={ih} r={(p.radius * 0.6 * w) / 270} />
			<div style={{marginTop: w * 0.06}}>{bar(iw * 0.78, w * 0.045, '#E3E3E8')}</div>
			<div style={{marginTop: w * 0.045, display: 'flex', gap: w * 0.012}}>
				{[0, 1, 2, 3, 4].map((s) => (
					<svg key={s} viewBox="0 0 24 24" style={{width: w * 0.075, height: w * 0.075, display: 'block'}}>
						<path d={STAR} fill={s < rating ? '#1F1F24' : '#D6D6DC'} />
					</svg>
				))}
			</div>
			<div style={{marginTop: w * 0.055, display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
				{bar(iw * 0.28, w * 0.06, '#2A2A30')}
				{bar(iw * 0.36, w * 0.11, '#ECECF0', {boxShadow: `inset 0 0 0 ${Math.max(1, w * 0.006)}px ${rgba('#000000', 0.06)}`})}
			</div>
		</div>
	);
};

const FloatCards: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, Ds, outro} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const mb = motionBlur('float-cards', u);
	const S = (k: string) => `fc${p.seed}:${k}`;
	const n = p.count;
	const cw0 = p.cardWidth * Math.min(W, H);
	const product = p.style === 'product';
	const heightOf = (w: number) => (product ? w * 0.07 + w * 0.86 * p.aspect + w * 0.46 : w * p.aspect);
	const C = {x0: (p.x - p.clear[0] / 2) * W, x1: (p.x + p.clear[0] / 2) * W, y0: (p.y - p.clear[1] / 2) * H, y1: (p.y + p.clear[1] / 2) * H};
	const gap = 14 * u;
	// slots spread evenly along a ring just inside the frame edges
	const mIn = cw0 * 0.42;
	const Wr = Math.max(1, W - 2 * mIn);
	const Hr = Math.max(1, H - 2 * mIn);
	const P = 2 * (Wr + Hr);
	const offset = rnd(S('off')) * (P / n);
	const outS = Math.min(outro, Ds * 0.5);
	const exT = outS > 0 ? prog(t, Ds - outS, Ds - 1 / fps) : 0;
	const exPrev = outS > 0 ? prog(t - 1 / fps, Ds - outS, Ds - 1 / fps) : 0;
	const ranks = Array.from({length: n}, (_, i) => i).sort((a, b) => rnd(S(`rk${a}`)) - rnd(S(`rk${b}`)));
	const rankOf = new Array<number>(n);
	ranks.forEach((ci, r) => (rankOf[ci] = r));

	const placed = Array.from({length: n}, (_, i) => {
		const sf = rnd(S(`sf${i}`), 0.86, 1.12);
		const w = cw0 * sf;
		const h = heightOf(w);
		const s = (offset + (i + 0.5 + rnd(S(`j${i}`), -0.2, 0.2)) * (P / n)) % P;
		let side: Side;
		let x: number;
		let y: number;
		if (s < Wr) [side, x, y] = ['top', mIn + s, mIn];
		else if (s < Wr + Hr) [side, x, y] = ['right', W - mIn, mIn + (s - Wr)];
		else if (s < 2 * Wr + Hr) [side, x, y] = ['bottom', W - mIn - (s - Wr - Hr), H - mIn];
		else [side, x, y] = ['left', mIn, H - mIn - (s - 2 * Wr - Hr)];
		const jn = rnd(S(`n${i}`), -0.12, 0.12) * w;
		if (side === 'top') y += jn;
		if (side === 'bottom') y -= jn;
		if (side === 'left') x += jn;
		if (side === 'right') x -= jn;
		// keep the centre zone clear (push outward), but keep at least 40 % of the card on screen
		const overlaps = x + w / 2 > C.x0 - gap && x - w / 2 < C.x1 + gap && y + h / 2 > C.y0 - gap && y - h / 2 < C.y1 + gap;
		if (overlaps) {
			if (side === 'top') y = Math.max(-h / 2 + 0.4 * h, Math.min(y, C.y0 - gap - h / 2));
			if (side === 'bottom') y = Math.min(H + h / 2 - 0.4 * h, Math.max(y, C.y1 + gap + h / 2));
			if (side === 'left') x = Math.max(-w / 2 + 0.4 * w, Math.min(x, C.x0 - gap - w / 2));
			if (side === 'right') x = Math.min(W + w / 2 - 0.4 * w, Math.max(x, C.x1 + gap + w / 2));
		}
		return {i, w, h, x, y, side};
	});
	// separate overlapping neighbours (along the edge they sit on), a few relaxation passes
	const PADX = 0.1 * cw0 + 10 * u; // room for rotation + drift
	for (let pass = 0; pass < 4; pass++) {
		for (let a = 0; a < n; a++) {
			for (let b = a + 1; b < n; b++) {
				const A = placed[a];
				const B = placed[b];
				const ox = (A.w + B.w) / 2 + PADX - Math.abs(A.x - B.x);
				const oy = (A.h + B.h) / 2 + PADX - Math.abs(A.y - B.y);
				if (ox <= 0 || oy <= 0) continue;
				const vertical = A.side === 'left' || A.side === 'right' ? B.side === 'left' || B.side === 'right' || oy < ox : oy < ox && !(B.side === 'top' || B.side === 'bottom');
				if (vertical) {
					const d = (oy / 2) * (A.y <= B.y ? -1 : 1);
					A.y += d;
					B.y -= d;
				} else {
					const d = (ox / 2) * (A.x <= B.x ? -1 : 1);
					A.x += d;
					B.x -= d;
				}
			}
		}
	}
	const cards = placed.map(({i, w, h, x, y, side}) => {
		const far = Math.max(w, h) * 0.8 + 40 * u;
		const off: [number, number] =
			side === 'top' ? [0, -(y + far)] : side === 'bottom' ? [0, H - y + far] : side === 'left' ? [-(x + far), 0] : [W - x + far, 0];
		const sign = side === 'left' || side === 'bottom' ? -1 : 1;
		return {i, w, h, x, y, off, sign, rot: rnd(S(`r${i}`), -p.rotate, p.rotate), start: 0.04 + rankOf[i] * p.stagger, exitAt: ((n - 1 - rankOf[i]) / Math.max(1, n - 1)) * 0.3};
	});

	const SPRING = {damping: 13, stiffness: 150, mass: 0.6};
	const pose = (c: (typeof cards)[number], f: number, ex: number) => {
		const tt = f / fps;
		const s = sp(f, fps, c.start, SPRING);
		const e = EXIT(prog(ex, c.exitAt, c.exitAt + 0.7));
		const k = 1 - s + e;
		// slow drift after landing: sway + a gentle parallax glide (bigger = nearer = moves more)
		const dep = c.w / cw0;
		const A = p.drift * u * 16 * dep * dep;
		const dx = A * Math.sin((2 * Math.PI * tt) / rnd(S(`px${c.i}`), 3.2, 5.2) + rnd(S(`fx${c.i}`), 0, 6.28)) + p.drift * u * rnd(S(`gx${c.i}`), -14, 14) * dep * tt;
		const dy = A * Math.sin((2 * Math.PI * tt) / rnd(S(`py${c.i}`), 3.6, 6) + rnd(S(`fy${c.i}`), 0, 6.28)) + p.drift * u * rnd(S(`gy${c.i}`), -12, 6) * dep * tt;
		return {
			x: c.x + c.off[0] * k + dx,
			y: c.y + c.off[1] * k + dy,
			rot: c.rot + (1 - s) * 14 * c.sign - e * 10 * c.sign + p.drift * 1.4 * Math.sin((2 * Math.PI * tt) / rnd(S(`pr${c.i}`), 4, 7) + rnd(S(`fr${c.i}`), 0, 6.28)),
			scale: 0.9 + 0.1 * Math.min(1, s),
			started: tt >= c.start,
		};
	};

	return (
		<AbsoluteFill>
			<MotionBlurDefs mb={mb} />
			{[...cards]
				.sort((a, b) => a.w - b.w)
				.map((c) => {
					const now = pose(c, frame, exT);
					if (!now.started) return null;
					const prev = pose(c, frame - 1, exPrev);
					const box = Math.max(c.w, c.h) * 1.5;
					if (now.x < -box || now.x > W + box || now.y < -box || now.y > H + box) return null;
					return (
						<Blurred key={c.i} mb={mb} x={now.x} y={now.y} box={box} dx={now.x - prev.x} dy={now.y - prev.y} strength={p.blur}>
							<div style={{transform: `rotate(${now.rot.toFixed(2)}deg) scale(${now.scale.toFixed(4)})`}}>
								{product ? (
									<ProductCard p={p} i={c.i} w={c.w} />
								) : (
									<div style={{boxShadow: `0 ${c.w * 0.04}px ${c.w * 0.12}px rgba(0,0,0,0.16)`, borderRadius: (p.radius * c.w) / 270}}>
										<ImageArea p={p} i={c.i} w={c.w} h={c.h} r={(p.radius * c.w) / 270} />
									</div>
								)}
							</div>
						</Blurred>
					);
				})}
		</AbsoluteFill>
	);
};

export const floatCards = defineLook({
	id: 'float-cards',
	category: 'ui',
	kind: 'overlay',
	duration: 4,
	outro: 0.4,
	customOutro: true,
	usesFont2: false,
	description:
		'Cards fly in from the nearest frame edge (motion blur, spring settle, staggered), sit around the edges with the centre kept clear for a stat, drift slowly with parallax, then fly back out. Shop-style product cards (image, stars, price + button bars) or plain image cards; procedural product tiles by default.',
	props,
	render: FloatCards,
});
