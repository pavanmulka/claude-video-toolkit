import React from 'react';
import {AbsoluteFill, Img, useCurrentFrame} from 'remotion';
import {z} from 'zod';
import {SPRINGS, clamp01, ease, sp} from '../lib/anim';
import {mix, rgba} from '../lib/color';
import {fontCss} from '../lib/fonts';
import {assetSrc, defineLook, useLook, type LookProps} from '../lib/look';
import {bool, doc, num, oneOf, str, strList} from '../lib/schema';

const props = {
	down: doc(z.array(z.number()).default([0.6, 1.4, 2.2, 3.0, 3.8]), 'Seconds at which fingers fold down, in folding order (up to 5; fewer = the rest stay up)'),
	order: oneOf(['pinky', 'thumb'] as const, 'pinky', 'Which finger folds first: pinky (pinky → ring → middle → index → thumb, ends in a fist) or thumb'),
	reopen: num(0, 'Seconds at which every finger springs back up (for a loop back to the first frame); 0 = never', 0, 600),
	size: num(640, 'Hand height (design units, fingertip to wrist)', 60, 2400),
	x: num(0.3, 'Hand centre x (fraction of width)', -0.5, 1.5),
	y: num(0.68, 'Hand centre y (fraction of height)', -0.5, 1.5),
	tilt: num(-8, 'Rotation of the whole hand in degrees', -90, 90),
	mirror: bool(false, 'Flip horizontally (thumb on the other side)'),
	fill: str('', 'Top-left colour of the hand gradient (hex); empty = theme accent'),
	fill2: str('', 'Bottom-right colour of the hand gradient (hex); empty = theme accent2'),
	outline: num(9, 'White sticker outline width (local units; 0 = none)', 0, 40),
	shadow: str('#3A2A6B', 'Drop-shadow colour (hex); empty = no shadow'),
	thread: str('', 'Colour of a thread / band tied around the wrist (hex, e.g. a red kalava #D7263D); empty = none'),
	enter: oneOf(['pop', 'rise', 'none'] as const, 'pop', 'Entrance: pop (springs up from 60 %), rise (slides up from below) or none (fully there on frame 0, for covers)'),
	idle: num(1, 'Gentle floating while it waits (0 = still)', 0, 4),
	badge: bool(false, 'Show a small round counter of the fingers still up next to the hand'),
	press: num(1, 'How much the hand dips on each fold (0 = none, 1 = default; photos read best at 0.3 or less)', 0, 3),
	fade: num(0.14, 'Photo mode: seconds each count dissolves into the next (0 = hard swap)', 0, 1),
	images: strList(
		[],
		'Photos shown instead of the drawn hand, one per count: the starting count first … the fist last (same canvas and placement in each, e.g. cut-out stickers). Each fold dissolves to the next photo (`fade`) with the same press; `size` = photo height',
	),
	path: doc(
		z.array(z.array(z.number())).default([]),
		'Keyframes [seconds, x, y, scale] that move the hand (eased in-out between keys; x/y fractions of the frame, scale × size); empty = stays at x, y',
	),
};

type P = LookProps<typeof props>;

// One sticker-style silhouette in a 400 x 640 box, palm facing the viewer. The fingers stand behind the palm; a fold
// shrinks the finger into the palm until only its bent knuckle shows above the palm edge, with a crease and a soft
// shadow. The thumb is in front and swings across the palm. A white outline + drop shadow are drawn around the union.
const PALM_TOP = 238;
type Finger = {cx: number; base: number; w: number; len: number; angle: number};
const FINGERS: Record<'index' | 'middle' | 'ring' | 'pinky', Finger> = {
	index: {cx: 135, base: 300, w: 51, len: 226, angle: -6},
	middle: {cx: 189, base: 300, w: 53, len: 254, angle: -1.5},
	ring: {cx: 242, base: 302, w: 50, len: 230, angle: 3},
	pinky: {cx: 290, base: 312, w: 43, len: 178, angle: 9},
};
const THUMB = {px: 128, py: 452, len: 168, open: -50, folded: 64};
const PALM = 'M104 306 Q104 238 172 238 L252 238 Q314 238 314 302 L309 442 Q303 514 240 518 L176 518 Q114 514 108 442 Z';

const thumbPath = (len: number) => `M-39 34 L-29 ${-len + 29} A29 29 0 0 1 29 ${-len + 29} L37 34 Z`;

const FingerCount: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const c1 = p.fill || theme.accent;
	const c2 = p.fill2 || theme.accent2;
	const shade = mix(c2, '#160C2C', 0.5);

	const seq = p.order === 'pinky' ? ['pinky', 'ring', 'middle', 'index', 'thumb'] : ['thumb', 'index', 'middle', 'ring', 'pinky'];
	const fold: Record<string, number> = {};
	seq.forEach((name, i) => {
		const at = p.down[i];
		let f = at === undefined ? 0 : clamp01(sp(frame, fps, at, SPRINGS.pop));
		if (p.reopen > 0) f *= 1 - clamp01(sp(frame, fps, p.reopen + (4 - i) * 0.05, SPRINGS.bouncy));
		fold[name] = f;
	});
	const up = seq.reduce((n, name) => n + (fold[name] < 0.5 ? 1 : 0), 0);

	// a small press on every fold (the hand dips as the finger goes down)
	const press = p.press * p.down.reduce((acc, at) => {
		const k = (t - at) / 0.28;
		return acc + (k > 0 && k < 1 ? Math.sin(k * Math.PI) : 0);
	}, 0);

	const ent = p.enter === 'none' ? 1 : clamp01(sp(frame, fps, 0, SPRINGS.bouncy));
	const scale = (p.enter === 'pop' ? 0.6 + 0.4 * ent : 1) * (1 - 0.035 * press);
	const rise = p.enter === 'rise' ? (1 - ent) * 0.6 * H : 0;
	const float = p.idle * 7 * u * Math.sin(t * 2.1);
	const opacity = p.enter === 'none' ? 1 : clamp01(ent * 1.6);

	// keyframed glide (e.g. big and centred on the cover, then aside while the lines play)
	let hx = p.x;
	let hy = p.y;
	let hs = 1;
	const keys = p.path.filter((kf) => kf.length >= 3);
	if (keys.length) {
		const at = (i: number) => [keys[i][0], keys[i][1], keys[i][2], keys[i][3] ?? 1];
		let [, x0, y0, s0] = at(0);
		[hx, hy, hs] = [x0, y0, s0];
		for (let i = 1; i < keys.length; i++) {
			const [t0] = at(i - 1);
			const [t1, x1, y1, s1] = at(i);
			if (t >= t1) {
				[hx, hy, hs] = [x1, y1, s1];
				[x0, y0, s0] = [x1, y1, s1];
				continue;
			}
			if (t > t0) {
				const q = ease.inOutCubic(clamp01((t - t0) / Math.max(1e-6, t1 - t0)));
				hx = x0 + (x1 - x0) * q;
				hy = y0 + (y1 - y0) * q;
				hs = s0 + (s1 - s0) * q;
			}
			break;
		}
	}
	const k = (p.size * hs * u) / 640; // local unit -> px
	const boxW = 400 * k;
	const boxH = 640 * k;
	const left = hx * W - boxW / 2;
	const top = hy * H - boxH / 2 + rise + float + 9 * k * press;

	const fingerGeo = (name: keyof typeof FINGERS) => {
		const fg = FINGERS[name];
		const f = fold[name];
		const stub = fg.base - PALM_TOP + fg.w * 0.48; // the bent knuckle that stays above the palm edge
		return {fg, f, h: fg.len * (1 - f) + stub * f, ang: fg.angle * (1 - 0.7 * f)};
	};
	const fingerShape = (name: keyof typeof FINGERS) => {
		const {fg, h, ang} = fingerGeo(name);
		return (
			<g key={name} transform={`translate(${fg.cx} ${fg.base}) rotate(${ang})`}>
				<rect x={-fg.w / 2} y={-h} width={fg.w} height={h + 40} rx={fg.w / 2} />
			</g>
		);
	};
	const fingerLines = (name: keyof typeof FINGERS) => {
		const {fg, f, h, ang} = fingerGeo(name);
		return (
			<g key={name} transform={`translate(${fg.cx} ${fg.base}) rotate(${ang})`}>
				{/* one soft joint line while it stands */}
				<path
					d={`M${-fg.w * 0.22} ${-h + fg.len * 0.42} q${fg.w * 0.22} ${fg.w * 0.1} ${fg.w * 0.44} 0`}
					stroke={rgba('#FFFFFF', 0.3 * (1 - f))}
					strokeWidth={3}
					strokeLinecap="round"
					fill="none"
				/>
				{/* the bend: a crease across the knuckle once folded */}
				<path
					d={`M${-fg.w * 0.3} ${-h + fg.w * 0.5} q${fg.w * 0.3} ${-fg.w * 0.16} ${fg.w * 0.6} 0`}
					stroke={rgba(shade, 0.38 * f)}
					strokeWidth={3.4}
					strokeLinecap="round"
					fill="none"
				/>
			</g>
		);
	};

	if (p.images.length) {
		// continuous count: each fold dissolves the photo into the next over `fade` seconds (no spring overshoot)
		const F = p.down.slice(0, p.images.length - 1).reduce((acc, at) => acc + (p.fade > 0 ? clamp01((t - at) / p.fade) : t >= at ? 1 : 0), 0);
		const reopenF = p.reopen > 0 ? clamp01((t - p.reopen) / Math.max(0.05, p.fade)) : 0;
		const Fc = F * (1 - reopenF);
		const base = Math.min(Math.floor(Fc), p.images.length - 1);
		const fr = Fc - base;
		const ss = (a: number, b: number, x: number) => {
			const q = clamp01((x - a) / (b - a));
			return q * q * (3 - 2 * q);
		};
		// the incoming photo fades in on top while the outgoing one stays solid until late: no see-through ghost mid-way
		const photoOpacity = (i: number) => (i === base ? 1 - ss(0.45, 1, fr) : i === base + 1 ? ss(0, 0.55, fr) : 0);
		const ph = p.size * hs * u;
		return (
			<AbsoluteFill style={{opacity}}>
				{p.images.map((src, i) => (
					<Img
						key={i}
						src={assetSrc(src)}
						style={{
							position: 'absolute',
							height: ph,
							left: hx * W,
							top: hy * H + rise + float + 9 * u * press,
							transform: `translate(-50%, -50%) rotate(${p.tilt}deg) scale(${scale}) ${p.mirror ? 'scaleX(-1)' : ''}`,
							transformOrigin: '50% 70%',
							opacity: photoOpacity(i),
						}}
					/>
				))}
			</AbsoluteFill>
		);
	}

	const tf = fold.thumb;
	const thumbAng = THUMB.open + (THUMB.folded - THUMB.open) * ease.outCubic(tf);
	const thumbLen = THUMB.len * (1 - 0.16 * tf);
	const R = p.outline;

	return (
		<AbsoluteFill style={{opacity}}>
			<svg
				width={boxW}
				height={boxH}
				viewBox="0 0 400 640"
				style={{
					position: 'absolute',
					left,
					top,
					overflow: 'visible',
					transform: `rotate(${p.tilt}deg) scale(${scale}) ${p.mirror ? 'scaleX(-1)' : ''}`,
					transformOrigin: '50% 70%',
				}}
			>
				<defs>
					<linearGradient id="fc-fill" gradientUnits="userSpaceOnUse" x1="70" y1="40" x2="330" y2="600">
						<stop offset="0" stopColor={c1} />
						<stop offset="1" stopColor={c2} />
					</linearGradient>
					<radialGradient id="fc-hi" gradientUnits="userSpaceOnUse" cx="175" cy="260" r="230">
						<stop offset="0" stopColor="#FFFFFF" stopOpacity={0.26} />
						<stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
					</radialGradient>
					<linearGradient id="fc-fade" gradientUnits="userSpaceOnUse" x1="0" y1="560" x2="0" y2="650">
						<stop offset="0" stopColor="#FFFFFF" />
						<stop offset="1" stopColor="#000000" />
					</linearGradient>
					<mask id="fc-mask" maskUnits="userSpaceOnUse" x="-300" y="-300" width="1000" height="1250">
						<rect x="-300" y="-300" width="1000" height="860" fill="#FFFFFF" />
						<rect x="-300" y="560" width="1000" height="90" fill="url(#fc-fade)" />
					</mask>
					<filter id="fc-sticker" x="-40%" y="-40%" width="180%" height="180%">
						<feMorphology in="SourceAlpha" operator="dilate" radius={R} result="grow" />
						<feFlood floodColor="#FFFFFF" result="white" />
						<feComposite in="white" in2="grow" operator="in" result="ring" />
						<feGaussianBlur in="grow" stdDeviation="16" result="blur" />
						<feOffset in="blur" dy="18" result="drop" />
						<feFlood floodColor={p.shadow || '#000000'} floodOpacity={p.shadow ? 0.26 : 0} result="sc" />
						<feComposite in="sc" in2="drop" operator="in" result="shadow" />
						<feMerge>
							<feMergeNode in="shadow" />
							{R > 0 ? <feMergeNode in="ring" /> : null}
							<feMergeNode in="SourceGraphic" />
						</feMerge>
					</filter>
				</defs>
				<mask id="fc-shape" maskUnits="userSpaceOnUse" x="-300" y="-300" width="1000" height="1250">
					<g fill="#FFFFFF">
						<rect x={142} y={470} width={136} height={200} rx={36} />
						{(['pinky', 'ring', 'middle', 'index'] as const).map(fingerShape)}
						<path d={PALM} />
						<g transform={`translate(${THUMB.px} ${THUMB.py}) rotate(${thumbAng})`}>
							<path d={thumbPath(thumbLen)} />
						</g>
					</g>
				</mask>
				<g mask="url(#fc-mask)">
					{/* the whole hand is one silhouette filled with one gradient, outlined like a sticker */}
					<g filter="url(#fc-sticker)">
						<rect x={-300} y={-300} width={1000} height={1250} fill="url(#fc-fill)" mask="url(#fc-shape)" />
					</g>
					<rect x={-300} y={-300} width={1000} height={1250} fill="url(#fc-hi)" mask="url(#fc-shape)" />
					{(['pinky', 'ring', 'middle', 'index'] as const).map(fingerLines)}
					<path d="M156 372 Q208 400 282 362" stroke={rgba(shade, 0.14)} strokeWidth={4} fill="none" strokeLinecap="round" />
					{/* thumb edge: shows where it crosses the palm once folded */}
					<g transform={`translate(${THUMB.px} ${THUMB.py}) rotate(${thumbAng})`}>
						<path d={thumbPath(thumbLen)} fill="none" stroke={rgba(shade, 0.32 * tf)} strokeWidth={3.4} strokeLinejoin="round" />
						<path d={`M-12 ${-thumbLen * 0.5} q12 6 24 0`} stroke={rgba('#FFFFFF', 0.3 * (1 - tf))} strokeWidth={3} strokeLinecap="round" fill="none" />
					</g>
					{p.thread ? (
						<g>
							{[0, 1, 2].map((i) => (
								<path
									key={i}
									d={`M142 ${534 + i * 8} Q210 ${545 + i * 8} 278 ${534 + i * 8}`}
									stroke={i === 1 ? mix(p.thread, '#000000', 0.2) : p.thread}
									strokeWidth={6}
									strokeLinecap="round"
									fill="none"
								/>
							))}
							<path d="M274 540 q14 10 9 28 M276 541 q20 3 24 21" stroke={p.thread} strokeWidth={4.5} strokeLinecap="round" fill="none" />
						</g>
					) : null}
				</g>
			</svg>
			{p.badge ? (
				<div
					style={{
						position: 'absolute',
						left: left + boxW * 0.92,
						top: top + boxH * 0.06,
						width: 120 * u,
						height: 120 * u,
						borderRadius: '50%',
						background: '#FFFFFF',
						boxShadow: `0 ${6 * u}px ${18 * u}px rgba(0,0,0,0.16)`,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						...fontCss(font),
						fontWeight: 900,
						fontSize: 68 * u,
						color: mix(c2, '#000000', 0.35),
						transform: `scale(${1 + 0.18 * Math.min(1, press)})`,
					}}
				>
					{up}
				</div>
			) : null}
		</AbsoluteFill>
	);
};

export const fingerCount = defineLook({
	id: 'finger-count',
	category: 'number',
	kind: 'overlay',
	duration: 5,
	outro: 0.3,
	usesFont2: false,
	description:
		'A sticker-style gradient hand (theme colours, white outline, soft shadow) that folds a finger down on each cue with a small press, ending in a fist; optional wrist thread, a counter badge and a reopen for the loop. Made for "put a finger down if…", countdowns of 5, "how many can you say yes to?".',
	props,
	render: FingerCount,
});
