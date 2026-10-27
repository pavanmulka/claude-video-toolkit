// crowd-fill: faces / photos pop in at seeded positions, accelerating, until the frame is packed
// ("a billion people", "every family"). Your own images (photos or cut-out PNGs) or built-in
// faceless head-and-shoulders avatars.
import React, {useMemo} from 'react';
import {AbsoluteFill, Img, useCurrentFrame} from 'remotion';
import {SPRINGS, clamp01, ease, lerp, prog, rnd, sp} from '../lib/anim';
import {mix} from '../lib/color';
import {assetSrc, defineLook, useLook, type LookProps} from '../lib/look';
import {int, num, oneOf, strList} from '../lib/schema';

const POPS = ['pop', 'snappy', 'bouncy', 'slam', 'smooth'] as const;

const props = {
	images: strList([], 'Images cycled over the items: photos (cropped to the shape) or cut-out PNGs (use shape=cutout). Empty = built-in faceless avatars'),
	count: int(140, 'Number of items (layout=grid rounds it to whole rows and columns)', 1, 600),
	fill: num(0.9, 'Seconds from the first item to the last one (the frame is full)', 0.05, 30),
	start: num(0.05, 'Seconds before the first item pops in', 0, 30),
	size: num(0, 'Item size in design units; 0 = automatic from count and frame area (items overlap so nothing shows through)', 0, 1200),
	sizeJitter: num(0.18, 'Random size variation (0.2 = ±20 %)', 0, 0.9),
	shape: oneOf(['circle', 'rounded', 'cutout'] as const, 'circle', 'circle / rounded square (images cropped, avatars on a pastel disc) | cutout (the image drawn as is: transparent PNG heads; avatars without a disc)'),
	pop: oneOf(POPS, 'pop', 'Pop-in style: pop (scale up with overshoot) | snappy | bouncy | slam (lands from big) | smooth'),
	accelerate: num(2.2, 'Stagger curve: 1 = steady rate; 2-3 = a few first, then a flood', 0.3, 6),
	layout: oneOf(['grid', 'scatter'] as const, 'grid', 'grid = jittered hex grid (complete coverage) | scatter = evenly spread random positions'),
	order: oneOf(['random', 'center', 'edges'] as const, 'random', 'Pop-in order: random | center (from x/y outward) | edges (from the edges toward x/y)'),
	jitter: num(0.22, 'Grid position jitter (fraction of the cell)', 0, 1),
	rotate: num(0, 'Random tilt per item in degrees (±)', 0, 45),
	drift: num(0.04, 'Slow push-in of the whole crowd over the look (0.04 = +4 %)', 0, 0.5),
	exit: oneOf(['zoom', 'pop', 'fade'] as const, 'zoom', 'Exit over `outro`: zoom (zoom-through with blur) | pop (items shrink away, last in first out) | fade'),
	bgColors: strList(['#E7EEFB', '#FCE7DE', '#E1F3EA', '#FCF1D6', '#ECE6FA', '#FBE3EA', '#DDF2F5', '#EDEDF1'], 'Disc colours behind the built-in avatars (circle / rounded)'),
	seed: int(1, 'Random seed for positions, order and avatar looks', 0, 1e6),
	x: num(0.5, 'Centre for order=center|edges (fraction of width)', 0, 1),
	y: num(0.5, 'Centre for order=center|edges (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const SKIN = ['#F7D7BE', '#EFC3A2', '#E0AC86', '#C98E68', '#AD7350', '#8D5A3C', '#6E432C', '#F3CDAF'];
const HAIR = ['#1F1813', '#3A2A20', '#5B3F2C', '#8E643B', '#C99B5E', '#2C2C2E', '#A3A3A8', '#9C4A2B'];
const SHIRT = ['#2F6FED', '#FF7A59', '#22A877', '#F2B23A', '#8B6CEF', '#E5527A', '#1FA9C0', '#3E3E52', '#F06B3C', '#5C9CF5'];

type Item = {x: number; y: number; s: number; t0: number; rot: number; idx: number; skin: string; hair: string; shirt: string; bg: string; style: number};

/** Faceless head-and-shoulders avatar in a 100x100 box (flat shapes, no features). */
const Avatar = React.memo<{it: Item; disc: boolean}>(({it, disc}) => {
	const {skin, hair, shirt, style} = it;
	const neck = mix(skin, '#000000', 0.14);
	const fringe =
		style === 5
			? 'M33.4,47 C31.5,31 40,24 50.5,24 C62,24 69,31.5 66.6,47 C65,40 63,36.5 58,35 C50,37.5 41,37 36.5,33.5 C34.5,37 33.8,42 33.4,47 Z'
			: 'M33.4,47 C31.8,31.5 40.2,24.2 50,24.2 C60.6,24.2 68.4,31.5 66.6,47 C64.6,39 59,34.6 51,35 C44,35.3 38.6,33.6 36.4,36.6 C35,39.4 34,43 33.4,47 Z';
	return (
		<svg viewBox={disc ? '7 9 86 86' : '0 0 100 100'} width="100%" height="100%" style={{display: 'block', overflow: disc ? 'hidden' : 'visible'}}>
			{style === 1 ? <path d="M30.5,50 C28.5,31 38,22 50,22 C62,22 71.5,31 69.5,50 L71,74 C65.5,77.5 60,76 57.5,71 L42.5,71 C40,76 34.5,77.5 29,74 Z" fill={hair} /> : null}
			{style === 3 ? <ellipse cx={50} cy={39} rx={23} ry={19} fill={hair} /> : null}
			{style === 2 ? <circle cx={50} cy={20.5} r={7.5} fill={hair} /> : null}
			<path d={disc ? 'M10,106 C10,82 27,71 50,71 C73,71 90,82 90,106 Z' : 'M14,100 C14,80 29,71 50,71 C71,71 86,80 86,100 Z'} fill={shirt} />
			<path d="M42.5,58 L57.5,58 L57.5,72.5 C57.5,76 42.5,76 42.5,72.5 Z" fill={neck} />
			<path d="M43.5,71.2 L50,79 L56.5,71.2 Z" fill={neck} />
			<ellipse cx={33.6} cy={48} rx={3.2} ry={4.6} fill={skin} />
			<ellipse cx={66.4} cy={48} rx={3.2} ry={4.6} fill={skin} />
			<ellipse cx={50} cy={45.5} rx={16.6} ry={19.6} fill={skin} />
			{style === 4 ? (
				<path d="M34.2,43 C34,31 41.5,26 50,26 C58.5,26 66,31 65.8,43 C62.5,36 57,33.6 50,33.6 C43,33.6 37.5,36 34.2,43 Z" fill={hair} opacity={0.55} />
			) : (
				<path d={fringe} fill={hair} />
			)}
		</svg>
	);
});
Avatar.displayName = 'Avatar';

/** Seeded Fisher-Yates permutation. */
const shuffle = (n: number, seed: string) => {
	const a = Array.from({length: n}, (_, i) => i);
	for (let i = n - 1; i > 0; i--) {
		const j = Math.floor(rnd(`${seed}${i}`) * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
};

const useCrowd = (p: P, W: number, H: number, u: number): Item[] =>
	useMemo(() => {
		const seed = `cf${p.seed}`;
		const pts: {x: number; y: number}[] = [];
		let auto: number;
		if (p.layout === 'grid') {
			// hex grid: N ~ (W/px + 0.5) * (H / (0.866 px) + 1)
			const px0 = Math.sqrt((W * H) / (0.866 * Math.max(1, p.count)));
			const cols = Math.max(1, Math.round(W / px0));
			const px = W / cols;
			const rh = px * 0.866;
			const rows = Math.ceil(H / rh) + 1;
			const y0 = (H - (rows - 1) * rh) / 2;
			for (let r = 0; r < rows; r++) {
				const odd = r % 2 === 1;
				const n = odd ? cols + 1 : cols;
				for (let c = 0; c < n; c++) {
					const k = pts.length;
					pts.push({
						x: (c + (odd ? 0 : 0.5)) * px + rnd(`${seed}jx${k}`, -0.5, 0.5) * p.jitter * px,
						y: y0 + r * rh + rnd(`${seed}jy${k}`, -0.5, 0.5) * p.jitter * rh,
					});
				}
			}
			auto = px * (1.3 + 0.35 * p.jitter);
		} else {
			// best-candidate sampling: evenly spread, never clumped
			const n = Math.max(1, p.count);
			const m = Math.sqrt((W * H) / n) * 0.25;
			for (let i = 0; i < n; i++) {
				let best = {x: 0, y: 0};
				let bestD = -1;
				for (let k = 0; k < 14; k++) {
					const c = {x: rnd(`${seed}sx${i}_${k}`, -m, W + m), y: rnd(`${seed}sy${i}_${k}`, -m, H + m)};
					let d = Infinity;
					for (const q of pts) d = Math.min(d, (q.x - c.x) ** 2 + (q.y - c.y) ** 2);
					if (d > bestD) {
						bestD = d;
						best = c;
					}
				}
				pts.push(best);
			}
			auto = Math.sqrt((W * H) / n) * 1.55;
		}
		const N = pts.length;
		const base = p.size > 0 ? p.size * u : auto;
		// pop-in rank
		let ranks: number[];
		if (p.order === 'random') {
			const perm = shuffle(N, `${seed}o`);
			ranks = new Array(N);
			perm.forEach((idx, r) => (ranks[idx] = r));
		} else {
			const cx = p.x * W;
			const cy = p.y * H;
			const diag = Math.hypot(W, H);
			const key = pts.map((q, i) => Math.hypot(q.x - cx, q.y - cy) / diag + rnd(`${seed}ok${i}`, 0, 0.12));
			const sorted = key.map((k, i) => ({k, i})).sort((a, b) => (p.order === 'center' ? a.k - b.k : b.k - a.k));
			ranks = new Array(N);
			sorted.forEach((s, r) => (ranks[s.i] = r));
		}
		const items: Item[] = pts.map((q, i) => {
			const f = N > 1 ? ranks[i] / (N - 1) : 0;
			return {
				x: q.x,
				y: q.y,
				s: base * (1 + rnd(`${seed}s${i}`, -1, 1) * p.sizeJitter),
				t0: p.start + p.fill * Math.pow(f, 1 / p.accelerate),
				rot: rnd(`${seed}r${i}`, -1, 1) * p.rotate,
				idx: ranks[i],
				skin: SKIN[Math.floor(rnd(`${seed}k${i}`) * SKIN.length)],
				hair: HAIR[Math.floor(rnd(`${seed}h${i}`) * HAIR.length)],
				shirt: SHIRT[Math.floor(rnd(`${seed}t${i}`) * SHIRT.length)],
				bg: p.bgColors.length ? p.bgColors[Math.floor(rnd(`${seed}b${i}`) * p.bgColors.length)] : 'transparent',
				style: Math.floor(rnd(`${seed}y${i}`) * 6),
			};
		});
		// later items are drawn on top
		return items.sort((a, b) => a.idx - b.idx);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [W, H, u, p.seed, p.layout, p.count, p.size, p.sizeJitter, p.jitter, p.order, p.x, p.y, p.start, p.fill, p.accelerate, p.rotate, JSON.stringify(p.bgColors)]);

const CrowdFill: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, Ds, exit} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const items = useCrowd(p, W, H, u);
	const cfg = p.pop === 'slam' ? SPRINGS.slam : SPRINGS[p.pop];
	const from = p.pop === 'slam' ? 1.7 : p.pop === 'smooth' ? 0.4 : 0;
	const N = items.length;
	const radius = p.shape === 'circle' ? '50%' : p.shape === 'rounded' ? '22%' : 0;
	const disc = p.shape !== 'cutout';
	const drift = 1 + p.drift * ease.inOutSine(prog(t, p.start, Ds));
	const zoomE = p.exit === 'zoom' ? exit : 0;
	const wrap: React.CSSProperties = {
		transform: `scale(${drift * (1 + 1.1 * zoomE * zoomE)})`,
		opacity: p.exit === 'fade' ? 1 - exit : p.exit === 'zoom' ? 1 - ease.inCubic(clamp01((exit - 0.35) / 0.65)) : 1,
		filter: zoomE > 0.02 ? `blur(${(22 * u * zoomE).toFixed(2)}px)` : undefined,
	};
	return (
		<AbsoluteFill style={wrap}>
			{items.map((it, k) => {
				if (t < it.t0) return null;
				const raw = sp(frame, fps, it.t0, cfg);
				const s = clamp01(raw);
				let sc = lerp(from, 1, raw);
				let op = clamp01(((t - it.t0) * fps) / 2.5);
				if (p.exit === 'pop' && exit > 0) {
					// last in, first out: the newest items leave first
					const e = ease.inCubic(clamp01((exit - (1 - it.idx / Math.max(1, N - 1)) * 0.5) / 0.5));
					sc *= 1 - e;
					op *= 1 - e * e;
				}
				if (sc <= 0.001 || op <= 0.001) return null;
				const img = p.images.length ? p.images[it.idx % p.images.length] : '';
				return (
					<div
						key={k}
						style={{
							position: 'absolute',
							left: it.x - it.s / 2,
							top: it.y - it.s / 2,
							width: it.s,
							height: it.s,
							borderRadius: radius,
							overflow: disc ? 'hidden' : 'visible',
							background: disc && !img ? it.bg : undefined,
							transform: `scale(${sc})${it.rot ? ` rotate(${(it.rot * (0.6 + 0.4 * s)).toFixed(2)}deg)` : ''}`,
							opacity: op,
						}}
					>
						{img ? (
							<Img src={assetSrc(img)} style={{width: '100%', height: '100%', objectFit: p.shape === 'cutout' ? 'contain' : 'cover', display: 'block'}} />
						) : (
							<Avatar it={it} disc={disc} />
						)}
					</div>
				);
			})}
		</AbsoluteFill>
	);
};

export const crowdFill = defineLook({
	id: 'crowd-fill',
	category: 'fx',
	kind: 'overlay',
	duration: 2.5,
	outro: 0.3,
	customOutro: true,
	usesFont2: false,
	description: 'Crowd fill: faces / photos pop in at seeded positions, a few first then a flood, until the frame is packed edge to edge ("a billion people", "every family"). Your own photos or cut-out PNGs, or built-in faceless avatars; jittered grid or scatter; zoom-through exit.',
	props,
	render: CrowdFill,
});
