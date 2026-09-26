// Full-frame animated backgrounds (kind: background, always opaque).
import {noise2D, noise3D} from '@remotion/noise';
import React, {useLayoutEffect, useMemo, useRef} from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {breathe, rnd} from '../lib/anim';
import {mix, parseColor, rgba} from '../lib/color';
import {Grain, lcg} from '../lib/grain';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {bool, color, int, num, oneOf, point, str, strList} from '../lib/schema';

const useT = () => {
	const frame = useCurrentFrame();
	const {fps} = useLook();
	return frame / fps;
};

// ------------------------------------------------------------------ bg-mesh
const meshProps = {
	colors: strList(['#FFC9A8', '#FF9EC4', '#B8A2FF', '#A8D8FF', '#C2FFE0'], 'Blob colours (3-7)'),
	base: color('#F7F2FF', 'Base colour under the blobs'),
	speed: num(1, 'Drift speed multiplier', 0, 10),
	blob: num(0.55, 'Blob radius as a fraction of the larger frame side', 0.1, 2),
	grain: num(0.06, 'Film grain 0-1', 0, 1),
};
type MeshP = LookProps<typeof meshProps>;
const BgMesh: React.FC<{p: MeshP}> = ({p}) => {
	const {W, H, u} = useLook();
	const t = useT();
	const R = Math.max(W, H) * p.blob;
	return (
		<AbsoluteFill style={{backgroundColor: p.base, overflow: 'hidden'}}>
			{p.colors.map((c, i) => {
				const ph = rnd(`mp${i}`, 0, Math.PI * 2);
				const f = rnd(`mf${i}`, 0.035, 0.07) * p.speed;
				const x = W * (0.5 + 0.44 * Math.sin(2 * Math.PI * f * t + ph));
				const y = H * (0.5 + 0.44 * Math.cos(2 * Math.PI * f * 0.83 * t + ph * 1.7));
				const r = R * (0.85 + 0.2 * Math.sin(2 * Math.PI * f * 1.3 * t + ph * 0.6));
				return (
					<div
						key={i}
						style={{
							position: 'absolute',
							left: x - r,
							top: y - r,
							width: 2 * r,
							height: 2 * r,
							borderRadius: '50%',
							background: `radial-gradient(circle closest-side, ${rgba(c, 0.95)} 0%, ${rgba(c, 0.55)} 38%, ${rgba(c, 0)} 100%)`,
						}}
					/>
				);
			})}
			<AbsoluteFill style={{background: `radial-gradient(ellipse at 50% 40%, ${rgba('#FFFFFF', 0.18)}, transparent 70%)`}} />
			<Grain amount={p.grain} u={u} blend="soft-light" />
		</AbsoluteFill>
	);
};
export const bgMesh = defineLook({
	id: 'bg-mesh',
	category: 'background',
	kind: 'background',
	duration: 8,
	usesFont2: false,
	description: 'Soft pastel mesh gradient: large colour blobs drift slowly on Lissajous paths over a light base, with fine animated grain (no banding). Colours via props.',
	props: meshProps,
	render: BgMesh,
});

// ------------------------------------------------------------------ bg-space
const spaceProps = {
	base: color('#05030C', 'Deep space base colour'),
	glowColor: str('', 'Stage glow colour (empty = theme.glow)'),
	stars: int(170, 'Number of stars', 0, 2000),
	arc: bool(true, 'Glowing planet-horizon arc at the bottom'),
	drift: num(1, 'Star drift speed multiplier', 0, 20),
	grain: num(0.05, 'Film grain 0-1', 0, 1),
};
type SpaceP = LookProps<typeof spaceProps>;
const BgSpace: React.FC<{p: SpaceP}> = ({p}) => {
	const {W, H, u, theme} = useLook();
	const t = useT();
	const ref = useRef<HTMLCanvasElement>(null);
	const glow = p.glowColor || theme.glow;
	const stars = useMemo(() => {
		const r = lcg(4242);
		return Array.from({length: p.stars}, () => ({x: r(), y: r(), s: Math.pow(r(), 3), ph: r() * Math.PI * 2, per: 1.5 + r() * 3, d: r(), tint: r()}));
	}, [p.stars]);
	useLayoutEffect(() => {
		const c = ref.current;
		const ctx = c?.getContext('2d');
		if (!c || !ctx) return;
		ctx.clearRect(0, 0, W, H);
		const tints = [theme.accent2, theme.accent, '#FFFFFF'];
		for (const st of stars) {
			const speed = (4 + 22 * st.d) * u * p.drift;
			const y = (((st.y * H - t * speed) % H) + H) % H;
			const x = st.x * W + Math.sin(t * 0.2 + st.ph) * 4 * u;
			const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin((t / st.per) * Math.PI * 2 + st.ph));
			const r = (0.6 + 2.2 * st.s) * u * (0.6 + 0.6 * st.d);
			const col = st.tint > 0.85 ? tints[Math.floor(st.tint * 10) % 2] : '#FFFFFF';
			if (st.s > 0.45) {
				const g = ctx.createRadialGradient(x, y, 0, x, y, r * 6);
				g.addColorStop(0, rgba(col, 0.5 * tw));
				g.addColorStop(1, rgba(col, 0));
				ctx.fillStyle = g;
				ctx.beginPath();
				ctx.arc(x, y, r * 6, 0, Math.PI * 2);
				ctx.fill();
			}
			ctx.fillStyle = rgba(col, tw);
			ctx.beginPath();
			ctx.arc(x, y, r, 0, Math.PI * 2);
			ctx.fill();
		}
	}, [t, W, H, u, stars, p.drift, theme.accent, theme.accent2]);
	const b = breathe(t, 6);
	const arcR = Math.max(W, H) * 1.35;
	return (
		<AbsoluteFill style={{background: `linear-gradient(180deg, ${mix(p.base, '#000000', 0.2)} 0%, ${p.base} 45%, ${mix(p.base, glow, 0.12)} 100%)`}}>
			<AbsoluteFill style={{background: `radial-gradient(ellipse 85% 42% at 50% 98%, ${rgba(glow, 0.55 + 0.08 * b)} 0%, ${rgba(glow, 0.18)} 45%, transparent 75%)`}} />
			<AbsoluteFill style={{background: `radial-gradient(ellipse 70% 35% at 30% 8%, ${rgba(theme.accent2, 0.1)} 0%, transparent 70%)`}} />
			<canvas ref={ref} width={W} height={H} style={{position: 'absolute', inset: 0}} />
			{p.arc ? (
				<div
					style={{
						position: 'absolute',
						left: W / 2 - arcR,
						top: H * 0.86,
						width: arcR * 2,
						height: arcR * 2,
						borderRadius: '50%',
						background: `radial-gradient(circle at 50% 0%, ${mix(p.base, glow, 0.25)} 0%, ${p.base} 18%)`,
						boxShadow: `0 0 ${60 * u}px ${14 * u}px ${rgba(glow, 0.55 + 0.1 * b)}, inset 0 ${10 * u}px ${40 * u}px ${rgba(mix(glow, '#FFFFFF', 0.4), 0.55)}`,
						borderTop: `${2 * u}px solid ${rgba(mix(glow, '#FFFFFF', 0.6), 0.9)}`,
					}}
				/>
			) : null}
			<AbsoluteFill style={{background: 'radial-gradient(ellipse 110% 80% at 50% 45%, transparent 55%, rgba(0,0,0,0.55) 100%)'}} />
			<Grain amount={p.grain} u={u} />
		</AbsoluteFill>
	);
};
export const bgSpace = defineLook({
	id: 'bg-space',
	category: 'background',
	kind: 'background',
	duration: 8,
	usesFont2: false,
	description: 'Deep navy/black space with a breathing purple "stage" glow at the bottom, a glowing planet-horizon arc, twinkling drifting stars (a few with soft halos), vignette and grain - the premium SaaS launch backdrop.',
	props: spaceProps,
	render: BgSpace,
});

// ------------------------------------------------------------------ bg-rays
const raysProps = {
	color: str('', 'Ray colour (empty = theme.accent2)'),
	base: str('', 'Base colour (empty = theme.bg)'),
	rays: int(16, 'Number of rays', 3, 90),
	speed: num(6, 'Rotation speed in degrees per second', -360, 360),
	center: point([0.5, 0.42], 'Ray centre [x, y] as fractions of the frame'),
	intensity: num(0.35, 'Ray opacity 0-1', 0, 1),
	grain: num(0.05, 'Film grain 0-1', 0, 1),
};
type RaysP = LookProps<typeof raysProps>;
const BgRays: React.FC<{p: RaysP}> = ({p}) => {
	const {u, theme} = useLook();
	const t = useT();
	const c = p.color || theme.accent2;
	const base = p.base || theme.bg;
	const per = 360 / p.rays;
	const w = per * 0.42;
	const cx = `${p.center[0] * 100}%`;
	const cy = `${p.center[1] * 100}%`;
	const a = p.intensity;
	const rays = (angle: number, alpha: number, width: number) =>
		`repeating-conic-gradient(from ${angle}deg at ${cx} ${cy}, ${rgba(c, 0)} 0deg, ${rgba(c, alpha)} ${width * 0.2}deg, ${rgba(c, alpha)} ${width * 0.8}deg, ${rgba(c, 0)} ${width}deg, ${rgba(c, 0)} ${per}deg)`;
	const mask = `radial-gradient(circle at ${cx} ${cy}, transparent 0%, #000 10%, #000 45%, transparent 85%)`;
	const b = breathe(t, 4);
	return (
		<AbsoluteFill style={{backgroundColor: base, overflow: 'hidden'}}>
			<AbsoluteFill style={{background: rays(t * p.speed, a, w), WebkitMaskImage: mask, maskImage: mask}} />
			<AbsoluteFill style={{background: rays(-t * p.speed * 0.6 + per / 2, a * 0.45, w * 0.6), WebkitMaskImage: mask, maskImage: mask}} />
			<AbsoluteFill style={{background: `radial-gradient(circle at ${cx} ${cy}, ${rgba(mix(c, '#FFFFFF', 0.4), 0.55 + 0.1 * b)} 0%, ${rgba(c, 0.25)} 16%, transparent 45%)`}} />
			<AbsoluteFill style={{background: 'radial-gradient(ellipse 100% 80% at 50% 50%, transparent 50%, rgba(0,0,0,0.5) 100%)'}} />
			<Grain amount={p.grain} u={u} />
		</AbsoluteFill>
	);
};
export const bgRays = defineLook({
	id: 'bg-rays',
	category: 'background',
	kind: 'background',
	duration: 8,
	usesFont2: false,
	description: 'Rotating starburst: two counter-rotating soft ray layers (conic gradients) radiating from a glowing centre, faded at the core and edges, with vignette and grain.',
	props: raysProps,
	render: BgRays,
});

// ------------------------------------------------------------------ bg-grid
const gridProps = {
	style: oneOf(['perspective', 'dots'] as const, 'perspective', 'perspective = 3D floor grid flying forward; dots = drifting dot grid with a moving spotlight'),
	color: str('', 'Line/dot colour (empty = theme.accent)'),
	base: str('', 'Base colour (empty = theme.bg)'),
	cell: num(64, 'Grid cell size (design units)', 20, 600),
	speed: num(1, 'Motion speed multiplier', 0, 20),
	grain: num(0.04, 'Film grain 0-1', 0, 1),
};
type GridP = LookProps<typeof gridProps>;
const BgGrid: React.FC<{p: GridP}> = ({p}) => {
	const {W, H, u, theme} = useLook();
	const t = useT();
	const c = p.color || theme.accent;
	const base = p.base || theme.bg;
	const cell = p.cell * u;
	const b = breathe(t, 5);
	if (p.style === 'dots') {
		const off = (t * 18 * u * p.speed) % cell;
		const sx = W * (0.5 + 0.3 * Math.sin(t * 0.35 * p.speed));
		const sy = H * (0.45 + 0.25 * Math.cos(t * 0.27 * p.speed));
		const mask = `radial-gradient(circle ${Math.max(W, H) * 0.55}px at ${sx}px ${sy}px, #000 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.12) 100%)`;
		return (
			<AbsoluteFill style={{backgroundColor: base}}>
				<AbsoluteFill
					style={{
						backgroundImage: `radial-gradient(circle, ${rgba(c, 0.9)} ${2.6 * u}px, transparent ${3.4 * u}px)`,
						backgroundSize: `${cell * 0.5}px ${cell * 0.5}px`,
						backgroundPosition: `${off}px ${off * 0.6}px`,
						WebkitMaskImage: mask,
						maskImage: mask,
					}}
				/>
				<AbsoluteFill style={{background: `radial-gradient(circle ${Math.max(W, H) * 0.4}px at ${sx}px ${sy}px, ${rgba(c, 0.16 + 0.05 * b)}, transparent 70%)`}} />
				<Grain amount={p.grain} u={u} />
			</AbsoluteFill>
		);
	}
	const off = (t * 90 * u * p.speed) % cell;
	const horizon = H * 0.42;
	return (
		<AbsoluteFill style={{backgroundColor: base, overflow: 'hidden'}}>
			<AbsoluteFill style={{background: `linear-gradient(180deg, ${base} 0%, ${mix(base, c, 0.08)} ${(horizon / H) * 100}%, ${base} 100%)`}} />
			<div style={{position: 'absolute', left: 0, right: 0, top: horizon, bottom: 0, perspective: 1100 * u, perspectiveOrigin: '50% 0%', overflow: 'hidden'}}>
				<div
					style={{
						position: 'absolute',
						left: -W * 2.5,
						width: W * 6,
						top: 0,
						height: H * 3,
						transformOrigin: '50% 0%',
						transform: 'rotateX(74deg)',
						backgroundImage: `linear-gradient(${rgba(c, 0.75)} ${2.4 * u}px, transparent ${2.4 * u}px), linear-gradient(90deg, ${rgba(c, 0.75)} ${2.4 * u}px, transparent ${2.4 * u}px)`,
						backgroundSize: `${cell}px ${cell}px`,
						backgroundPosition: `0px ${off}px`,
						WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, #000 22%, #000 100%)',
						maskImage: 'linear-gradient(180deg, transparent 0%, #000 22%, #000 100%)',
					}}
				/>
			</div>
			<div style={{position: 'absolute', left: 0, right: 0, top: horizon - 2 * u, height: 4 * u, background: `linear-gradient(90deg, transparent, ${rgba(mix(c, '#FFFFFF', 0.5), 0.9)}, transparent)`, boxShadow: `0 0 ${40 * u}px ${10 * u}px ${rgba(c, 0.35 + 0.1 * b)}`}} />
			<AbsoluteFill style={{background: `radial-gradient(ellipse 60% 22% at 50% ${(horizon / H) * 100}%, ${rgba(c, 0.3 + 0.08 * b)}, transparent 70%)`}} />
			<AbsoluteFill style={{background: 'radial-gradient(ellipse 110% 80% at 50% 45%, transparent 55%, rgba(0,0,0,0.5) 100%)'}} />
			<Grain amount={p.grain} u={u} />
		</AbsoluteFill>
	);
};
export const bgGrid = defineLook({
	id: 'bg-grid',
	category: 'background',
	kind: 'background',
	duration: 8,
	usesFont2: false,
	description: 'Glowing grid: a 3D perspective floor grid gliding toward the viewer under a bright horizon line (style=perspective), or a drifting dot grid lit by a wandering spotlight (style=dots).',
	props: gridProps,
	render: BgGrid,
});

// ------------------------------------------------------------------ bg-liquid
const liquidProps = {
	colors: strList([], 'Two or more line colours (empty = theme.accent2 -> theme.accent)'),
	base: str('', 'Base colour (empty = theme.bg)'),
	lines: int(14, 'Number of contour levels', 2, 60),
	scale: num(1, 'Pattern scale (bigger = larger shapes)', 0.2, 5),
	speed: num(1, 'Flow speed multiplier', 0, 20),
	thickness: num(2.2, 'Line thickness (design units)', 0.5, 20),
	grain: num(0.04, 'Film grain 0-1', 0, 1),
};
type LiquidP = LookProps<typeof liquidProps>;
const BgLiquid: React.FC<{p: LiquidP}> = ({p}) => {
	const {W, H, u, theme} = useLook();
	const t = useT();
	const ref = useRef<HTMLCanvasElement>(null);
	const base = p.base || theme.bg;
	const cols = p.colors.length >= 2 ? p.colors : [theme.accent2, theme.accent];
	useLayoutEffect(() => {
		const c = ref.current;
		const ctx = c?.getContext('2d');
		if (!c || !ctx) return;
		ctx.clearRect(0, 0, W, H);
		const cell = 13 * u;
		const nx = Math.ceil(W / cell) + 1;
		const ny = Math.ceil(H / cell) + 1;
		const sc = 0.0019 / (p.scale * u);
		const z = t * 0.09 * p.speed;
		const f = new Float32Array(nx * ny);
		for (let j = 0; j < ny; j++) {
			for (let i = 0; i < nx; i++) {
				const x = i * cell * sc;
				const y = j * cell * sc;
				const wx = x + 0.35 * noise3D('lw', x * 0.7, y * 0.7, z * 0.6);
				f[j * nx + i] = noise3D('lq', wx, y, z) * 0.75 + noise3D('lq2', wx * 2.1, y * 2.1, z * 1.4) * 0.25;
			}
		}
		const L = p.lines;
		for (let pass = 0; pass < 2; pass++) {
			for (let k = 0; k < L; k++) {
				const lv = -0.75 + (1.5 * (k + 0.5)) / L;
				const fr = L > 1 ? k / (L - 1) : 0;
				const seg = fr * (cols.length - 1);
				const ci = Math.min(cols.length - 2, Math.floor(seg));
				const colr = mix(cols[ci], cols[ci + 1], seg - ci);
				ctx.strokeStyle = pass === 0 ? rgba(colr, 0.14) : rgba(colr, 0.85);
				ctx.lineWidth = (pass === 0 ? 5 : 1) * p.thickness * u;
				ctx.lineCap = 'round';
				ctx.beginPath();
				for (let j = 0; j < ny - 1; j++) {
					for (let i = 0; i < nx - 1; i++) {
						const a = f[j * nx + i];
						const b = f[j * nx + i + 1];
						const cc = f[(j + 1) * nx + i + 1];
						const d = f[(j + 1) * nx + i];
						const idx = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (cc > lv ? 2 : 0) | (d > lv ? 1 : 0);
						if (idx === 0 || idx === 15) continue;
						const x0 = i * cell;
						const y0 = j * cell;
						const lerpE = (va: number, vb: number) => (lv - va) / (vb - va || 1e-6);
						const top = () => [x0 + cell * lerpE(a, b), y0];
						const right = () => [x0 + cell, y0 + cell * lerpE(b, cc)];
						const bottom = () => [x0 + cell * lerpE(d, cc), y0 + cell];
						const left = () => [x0, y0 + cell * lerpE(a, d)];
						const segs: number[][][] = [];
						switch (idx) {
							case 1: case 14: segs.push([left(), bottom()]); break;
							case 2: case 13: segs.push([bottom(), right()]); break;
							case 3: case 12: segs.push([left(), right()]); break;
							case 4: case 11: segs.push([top(), right()]); break;
							case 5: segs.push([left(), top()], [bottom(), right()]); break;
							case 6: case 9: segs.push([top(), bottom()]); break;
							case 7: case 8: segs.push([left(), top()]); break;
							case 10: segs.push([top(), right()], [left(), bottom()]); break;
						}
						for (const [p1, p2] of segs) {
							ctx.moveTo(p1[0], p1[1]);
							ctx.lineTo(p2[0], p2[1]);
						}
					}
				}
				ctx.stroke();
			}
		}
	}, [t, W, H, u, p.lines, p.scale, p.speed, p.thickness, cols.join(',')]);
	return (
		<AbsoluteFill style={{backgroundColor: base}}>
			<AbsoluteFill style={{background: `radial-gradient(ellipse 80% 60% at 50% 45%, ${rgba(cols[0], 0.14)}, transparent 70%)`}} />
			<canvas ref={ref} width={W} height={H} style={{position: 'absolute', inset: 0}} />
			<AbsoluteFill style={{background: 'radial-gradient(ellipse 110% 80% at 50% 50%, transparent 55%, rgba(0,0,0,0.45) 100%)'}} />
			<Grain amount={p.grain} u={u} />
		</AbsoluteFill>
	);
};
export const bgLiquid = defineLook({
	id: 'bg-liquid',
	category: 'background',
	kind: 'background',
	duration: 8,
	usesFont2: false,
	description: 'Liquid topography: glowing contour lines of a slowly flowing, domain-warped noise field (marching squares on canvas), coloured along a gradient from accent2 to accent.',
	props: liquidProps,
	render: BgLiquid,
});

// ------------------------------------------------------------------ bg-paper
const paperProps = {
	paper: color('#F2EADF', 'Paper colour'),
	grain: num(0.12, 'Film grain 0-1', 0, 1),
	fibers: bool(true, 'Visible paper fibres'),
	vignette: num(0.3, 'Edge darkening 0-1', 0, 1),
};
type PaperP = LookProps<typeof paperProps>;
const BgPaper: React.FC<{p: PaperP}> = ({p}) => {
	const {W, H, u} = useLook();
	const t = useT();
	const tex = useMemo(() => {
		const w = Math.max(64, Math.round(W / 2));
		const h = Math.max(64, Math.round(H / 2));
		const c = document.createElement('canvas');
		c.width = w;
		c.height = h;
		const ctx = c.getContext('2d');
		if (!ctx) return '';
		const img = ctx.createImageData(w, h);
		const {r: pr, g: pg, b: pb} = parseColor(p.paper);
		const r = lcg(99);
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const m = noise2D('pm', x * 0.004, y * 0.004) * 0.6 + noise2D('pm2', x * 0.02, y * 0.02) * 0.3 + noise2D('pm3', x * 0.09, y * 0.09) * 0.1;
				const v = m * 9 + (r() - 0.5) * 6;
				const i = (y * w + x) * 4;
				img.data[i] = Math.max(0, Math.min(255, pr + v));
				img.data[i + 1] = Math.max(0, Math.min(255, pg + v * 0.95));
				img.data[i + 2] = Math.max(0, Math.min(255, pb + v * 0.85));
				img.data[i + 3] = 255;
			}
		}
		ctx.putImageData(img, 0, 0);
		if (p.fibers) {
			for (let k = 0; k < (w * h) / 900; k++) {
				const x = r() * w;
				const y = r() * h;
				const a = r() * Math.PI;
				const len = 4 + r() * 16;
				ctx.strokeStyle = r() > 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(120,95,70,0.14)';
				ctx.lineWidth = 0.5 + r() * 0.6;
				ctx.beginPath();
				ctx.moveTo(x, y);
				ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (r() - 0.5) * 3, y + Math.sin(a) * len * 0.5 + (r() - 0.5) * 3, x + Math.cos(a) * len, y + Math.sin(a) * len);
				ctx.stroke();
			}
		}
		return c.toDataURL('image/png');
	}, [W, H, p.paper, p.fibers]);
	const lx = 50 + 18 * Math.sin(t * 0.25);
	const ly = 40 + 12 * Math.cos(t * 0.2);
	return (
		<AbsoluteFill style={{backgroundColor: p.paper}}>
			{tex ? <AbsoluteFill style={{backgroundImage: `url(${tex})`, backgroundSize: '100% 100%'}} /> : null}
			<AbsoluteFill style={{background: `radial-gradient(ellipse 70% 50% at ${lx}% ${ly}%, rgba(255,250,240,0.35), transparent 70%)`}} />
			<AbsoluteFill style={{background: `radial-gradient(ellipse 110% 85% at 50% 50%, transparent 50%, rgba(70,50,30,${p.vignette * 0.55}) 100%)`}} />
			<Grain amount={p.grain} u={u} blend="multiply" />
		</AbsoluteFill>
	);
};
export const bgPaper = defineLook({
	id: 'bg-paper',
	category: 'background',
	kind: 'background',
	duration: 8,
	usesFont2: false,
	description: 'Warm paper: procedural mottled paper texture with fibres, a slowly drifting soft light, vignette and animated multiply grain - for editorial looks (pair with dark text / the italic serif).',
	props: paperProps,
	render: BgPaper,
});
