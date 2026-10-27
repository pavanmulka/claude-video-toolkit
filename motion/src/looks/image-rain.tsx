import React from 'react';
import {AbsoluteFill, Img, useCurrentFrame} from 'remotion';
import {clamp01, ease, rnd} from '../lib/anim';
import {mix, rgba} from '../lib/color';
import {EMOJI_STACK} from '../lib/fonts';
import {assetSrc, defineLook, useLook, type LookProps} from '../lib/look';
import {Blurred, MotionBlurDefs, motionBlur} from '../lib/motion-blur';
import {bool, int, num, oneOf, point, strList} from '../lib/schema';

const props = {
	mode: oneOf(
		['rain', 'stream', 'fountain'] as const,
		'rain',
		'rain = items fall from above across the whole width; stream = shot from `origin` toward `direction` like a money gun, then curl and float down; fountain = burst up from `origin`, then flutter down',
	),
	images: strList([], 'Item images (PNG cut-outs or JPG), cycled; empty = `emojis`, else the procedural `shape`'),
	emojis: strList([], 'Emoji items (Apple Color Emoji), used when `images` is empty'),
	shape: oneOf(
		['note', 'card', 'confetti', 'coin'] as const,
		'note',
		'Procedural item when images and emojis are empty: note = generic green banknote (no real currency art), card = payment-style card, confetti = paper bits, coin',
	),
	colors: strList([], 'Colours for procedural items (note tint, cards, confetti), cycled; empty = natural green notes / gold coins / theme colours'),
	count: int(44, 'Items in total (rain, fountain)', 1, 400),
	rate: num(32, 'Items per second (stream)', 1, 400),
	size: num(240, 'Item width in design units (notes, cards, images; coins ~0.4x, confetti ~0.15x, emojis ~0.5x of it)', 8, 1200),
	sizeJitter: num(0.18, 'Random size variation (0 = all the same)', 0, 1),
	speed: num(-1, 'Design units per second: rain = fall speed, stream / fountain = launch speed; -1 = auto (rain 1000, stream 3200, fountain 3000)', -1, 20000),
	gravity: num(1700, 'Gravity for stream / fountain (design units per second squared); items also feel paper-like air drag', -20000, 20000),
	drag: num(1, 'Air drag multiplier for stream / fountain (higher = slows sooner and floats down slower)', 0.05, 10),
	origin: point([-1, -1], 'Launch point [x, y] in frame fractions (stream, fountain); [-1, -1] = auto (stream lower left [0.08, 0.84], fountain bottom centre [0.5, 1.06])'),
	direction: num(-999, 'Launch direction in degrees (stream, fountain): -90 = up, -45 = up-right, 0 = right; -999 = auto (stream aims up toward the far side, fountain straight up)', -999, 360),
	spread: num(-1, 'Cone angle in degrees (stream, fountain); -1 = auto (stream 24, fountain 50)', -1, 360),
	flutter: num(1, '3D flutter: rotateX / rotateY wobble, some items tumble end over end (0 = flat)', 0, 3),
	curl: num(0.6, 'Paper bend while fluttering (notes and images; 0 = rigid)', 0, 2),
	spin: num(120, 'In-plane spin in degrees per second (random direction per item)', 0, 2000),
	depth: num(0.6, 'Depth range 0-1: far items get smaller, slower and softer (parallax)', 0, 1),
	blur: num(1, 'Motion blur along each item\'s direction of travel (0 = off)', 0, 4),
	shadow: bool(true, 'Soft drop shadow under each item'),
	start: num(0, 'Seconds before the first item is released', 0, 600),
	emit: num(-1, 'Seconds over which items are released; -1 = auto (rain: until ~1 s before the end, stream 1.6, fountain 0.12 = one burst)', -1, 600),
	seed: int(1, 'Random seed (another arrangement)', 0, 1e9),
	preroll: num(0, 'Seconds of motion already played at the first frame: items start mid-flight (e.g. a burst already in the air on the cover frame)', 0, 600),
};

type P = LookProps<typeof props>;
type Kind = 'image' | 'emoji' | 'note' | 'card' | 'confetti' | 'coin';

const DEG = Math.PI / 180;
const smooth = (x: number) => {
	const c = Math.min(1, Math.max(0, x));
	return c * c * (3 - 2 * c);
};

/** Generic banknote: rounded rect, darker border, guilloche texture, a circle seal and two lines. */
const Note: React.FC<{w: number; base: string}> = ({w, base}) => {
	const h = w * 0.44;
	const light = mix(base, '#FFFFFF', 0.55);
	const dark = mix(base, '#000000', 0.12);
	const ink = mix(base, '#000000', 0.62);
	const line = Math.max(1, h * 0.022);
	return (
		<div style={{position: 'relative', width: w, height: h, borderRadius: w * 0.035, overflow: 'hidden', background: `linear-gradient(120deg, ${light} 0%, ${base} 48%, ${dark} 100%)`}}>
			<div style={{position: 'absolute', inset: 0, background: `repeating-linear-gradient(62deg, ${rgba('#FFFFFF', 0.16)} 0 ${h * 0.018}px, transparent ${h * 0.018}px ${h * 0.06}px)`}} />
			<div style={{position: 'absolute', inset: h * 0.07, border: `${line}px solid ${rgba(ink, 0.55)}`, borderRadius: w * 0.02}} />
			<div style={{position: 'absolute', inset: h * 0.13, border: `${line * 0.6}px solid ${rgba(ink, 0.3)}`, borderRadius: w * 0.015}} />
			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: '50%',
					width: h * 0.52,
					height: h * 0.52,
					transform: 'translate(-50%, -50%)',
					borderRadius: '50%',
					border: `${line * 1.4}px solid ${rgba(ink, 0.6)}`,
					background: `radial-gradient(circle at 40% 35%, ${rgba('#FFFFFF', 0.55)} 0%, ${rgba(light, 0.4)} 45%, ${rgba(dark, 0.6)} 100%)`,
				}}
			>
				<div style={{position: 'absolute', inset: '24%', borderRadius: '50%', border: `${line}px solid ${rgba(ink, 0.45)}`}} />
			</div>
			<div style={{position: 'absolute', left: w * 0.1, top: h * 0.36, width: w * 0.2, height: h * 0.07, borderRadius: h, background: rgba(ink, 0.5)}} />
			<div style={{position: 'absolute', right: w * 0.1, top: h * 0.57, width: w * 0.2, height: h * 0.07, borderRadius: h, background: rgba(ink, 0.5)}} />
			<div style={{position: 'absolute', left: w * 0.09, bottom: h * 0.17, width: h * 0.13, height: h * 0.13, borderRadius: '50%', background: rgba(ink, 0.35)}} />
			<div style={{position: 'absolute', right: w * 0.09, top: h * 0.17, width: h * 0.13, height: h * 0.13, borderRadius: '50%', background: rgba(ink, 0.35)}} />
		</div>
	);
};

/** Generic payment-style card: gradient, chip, two light lines, two overlapping circles. */
const PayCard: React.FC<{w: number; base: string}> = ({w, base}) => {
	const h = w * 0.63;
	return (
		<div style={{position: 'relative', width: w, height: h, borderRadius: w * 0.06, overflow: 'hidden', background: `linear-gradient(135deg, ${mix(base, '#FFFFFF', 0.25)} 0%, ${base} 55%, ${mix(base, '#000000', 0.25)} 100%)`}}>
			<div style={{position: 'absolute', inset: 0, background: `radial-gradient(ellipse 80% 60% at 20% 0%, ${rgba('#FFFFFF', 0.28)} 0%, transparent 70%)`}} />
			<div style={{position: 'absolute', left: w * 0.1, top: h * 0.32, width: w * 0.15, height: w * 0.11, borderRadius: w * 0.02, background: 'linear-gradient(135deg, #F7E2A0 0%, #D8B45A 100%)'}} />
			<div style={{position: 'absolute', left: w * 0.1, top: h * 0.68, width: w * 0.5, height: h * 0.06, borderRadius: h, background: rgba('#FFFFFF', 0.7)}} />
			<div style={{position: 'absolute', left: w * 0.1, top: h * 0.8, width: w * 0.28, height: h * 0.05, borderRadius: h, background: rgba('#FFFFFF', 0.45)}} />
			<div style={{position: 'absolute', right: w * 0.17, top: h * 0.1, width: w * 0.13, height: w * 0.13, borderRadius: '50%', background: rgba('#FFFFFF', 0.55)}} />
			<div style={{position: 'absolute', right: w * 0.09, top: h * 0.1, width: w * 0.13, height: w * 0.13, borderRadius: '50%', background: rgba('#FFFFFF', 0.35)}} />
		</div>
	);
};

const Coin: React.FC<{d: number; base: string}> = ({d, base}) => (
	<div
		style={{
			width: d,
			height: d,
			borderRadius: '50%',
			background: `radial-gradient(circle at 35% 30%, ${mix(base, '#FFFFFF', 0.6)} 0%, ${base} 45%, ${mix(base, '#000000', 0.3)} 100%)`,
			boxShadow: `inset 0 0 0 ${d * 0.06}px ${mix(base, '#000000', 0.18)}`,
			position: 'relative',
		}}
	>
		<div style={{position: 'absolute', inset: '20%', borderRadius: '50%', border: `${Math.max(1, d * 0.035)}px solid ${rgba(mix(base, '#000000', 0.35), 0.6)}`}} />
		<div style={{position: 'absolute', left: '42%', top: '30%', width: '16%', height: '40%', borderRadius: d, background: rgba(mix(base, '#000000', 0.35), 0.5)}} />
	</div>
);

const ImageRain: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, Ds} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps + p.preroll;
	const mb = motionBlur('image-rain', u);
	const mode = p.mode;
	const kind: Kind = p.images.length ? 'image' : p.emojis.length ? 'emoji' : p.shape;
	const speed = (p.speed > 0 ? p.speed : mode === 'rain' ? 1000 : mode === 'stream' ? 3200 : 3000) * u;
	const emit = p.emit >= 0 ? p.emit : mode === 'rain' ? Math.max(0.6, Ds - p.start - 1.1) : mode === 'stream' ? 1.6 : 0.12;
	const n = mode === 'stream' ? Math.max(1, Math.min(400, Math.round(p.rate * emit))) : p.count;
	const autoOrigin = p.origin[0] === -1 && p.origin[1] === -1;
	const ox = (autoOrigin ? (mode === 'stream' ? 0.08 : 0.5) : p.origin[0]) * W;
	const oy = (autoOrigin ? (mode === 'stream' ? 0.84 : 1.06) : p.origin[1]) * H;
	const dir = p.direction > -999 ? p.direction : mode === 'stream' ? (ox > W / 2 ? -122 : -58) : -90;
	const spread = p.spread >= 0 ? p.spread : mode === 'stream' ? 24 : 50;
	const g = p.gravity * u;
	const S = (k: string) => `ir${p.seed}:${k}`;
	const palette = p.colors.length
		? p.colors
		: kind === 'note'
			? ['#97C17F', '#8DB876', '#A3C98C']
			: kind === 'coin'
				? ['#F2B632', '#E9A825']
				: [theme.accent, theme.accent2, theme.glow, '#FFC94D', '#FF5A8A'];
	const rigid = kind === 'card' || kind === 'coin' || kind === 'confetti' || kind === 'emoji';
	const curl = rigid ? 0 : p.curl;

	// rain: stratified x positions in a shuffled order so the whole width fills evenly
	const order = Array.from({length: n}, (_, i) => i).sort((a, b) => rnd(S(`perm${a}`)) - rnd(S(`perm${b}`)));

	type Item = {i: number; te: number; d: number; f: number; w: number; box: number; k: number; vx0: number; vy0: number; x0: number; y0: number; vf: number; wind: number; sway: number; ws: number; ph: number};
	const items: Item[] = [];
	for (let i = 0; i < n; i++) {
		const d = p.depth * Math.pow(rnd(S(`d${i}`)), 1.25);
		const f = 1 - 0.45 * d;
		const sc = (1 - 0.5 * d) * (1 + p.sizeJitter * rnd(S(`s${i}`), -1, 1));
		const unit = kind === 'coin' ? 0.42 : kind === 'confetti' ? 0.15 : kind === 'emoji' ? 0.5 : 1;
		const w = p.size * u * unit * sc;
		const box = w * (kind === 'confetti' ? 2.2 : kind === 'image' ? 1.7 : 1.45);
		let te: number;
		if (mode === 'rain') te = p.start + (i / n) * emit + rnd(S(`te${i}`), -0.5, 0.5) * (emit / n);
		else if (mode === 'stream') te = p.start + (i / n) * emit + rnd(S(`te${i}`), 0, 0.8) * (emit / n);
		else te = p.start + rnd(S(`te${i}`)) * emit;
		const a = (dir + rnd(S(`a${i}`), -0.5, 0.5) * spread) * DEG;
		const v = speed * rnd(S(`v${i}`), mode === 'stream' ? 0.62 : 0.6, 1.12);
		const slot = order[i];
		items.push({
			i,
			te,
			d,
			f,
			w,
			box,
			k: rnd(S(`k${i}`), 1.0, 1.6) * p.drag,
			vx0: v * Math.cos(a),
			vy0: v * Math.sin(a),
			x0: -0.05 * W + ((slot + rnd(S(`x${i}`), 0.1, 0.9)) / n) * W * 1.1,
			y0: -box / 2 - rnd(S(`y${i}`), 0, 0.12) * H,
			vf: speed * f * rnd(S(`vf${i}`), 0.85, 1.15),
			wind: rnd(S(`wd${i}`), -60, 60) * u,
			sway: rnd(S(`sw${i}`), 30, 80) * u * p.flutter,
			ws: 2 * Math.PI * rnd(S(`ws${i}`), 0.45, 0.95),
			ph: rnd(S(`ph${i}`), 0, 2 * Math.PI),
		});
	}

	const place = (it: Item, tt: number) => {
		const lt = tt - it.te;
		if (lt < 0) return null;
		if (mode === 'rain') {
			return {lt, x: it.x0 + it.wind * lt + it.sway * Math.sin(it.ws * lt + it.ph), y: it.y0 + it.vf * lt};
		}
		// thrown paper: low drag while fast, the drag grows as it starts to flutter (slow, floaty fall)
		const steps = Math.max(1, Math.ceil(lt * 240));
		const h = lt / steps;
		let x = 0;
		let y = 0;
		let vx = it.vx0;
		let vy = it.vy0;
		for (let s = 0; s < steps; s++) {
			const k = it.k * (0.5 + 1.9 * smooth((s * h) / 0.9));
			vx += -k * vx * h;
			vy += (g - k * vy) * h;
			x += vx * h;
			y += vy * h;
		}
		const sw = it.sway * smooth(lt / 1.0);
		return {lt, x: ox + x + sw * Math.sin(it.ws * lt + it.ph), y: oy + y + 0.3 * sw * Math.sin(2 * it.ws * lt + it.ph)};
	};

	const nodes: React.ReactNode[] = [];
	const sorted = [...items].sort((a, b) => b.d - a.d);
	for (const it of sorted) {
		const cur = place(it, t);
		if (!cur) continue;
		const {lt, x, y} = cur;
		const half = it.box / 2;
		if (x < -half || x > W + half || y < -half || y > H + half) continue;
		const prev = place(it, t - 1 / fps) ?? cur;
		const dx = x - prev.x;
		const dy = y - prev.y;
		const i = it.i;
		// flutter: fast items fly flatter, slowed items wobble and tumble
		const calm = mode === 'rain' ? 1 : 0.4 + 0.6 * smooth(lt / 0.8);
		const amp = p.flutter * calm;
		const tumble = rnd(S(`tb${i}`)) < 0.3 * Math.min(1, p.flutter) || kind === 'coin';
		const tsign = rnd(S(`tbs${i}`)) < 0.5 ? -1 : 1;
		const rx = tumble
			? rnd(S(`rx0${i}`), 0, 360) + tsign * 300 * rnd(S(`rxs${i}`), 0.6, 1.3) * p.flutter * lt
			: 52 * amp * Math.sin(2 * Math.PI * rnd(S(`wx${i}`), 0.7, 1.5) * lt + rnd(S(`px${i}`), 0, 6.28));
		const ry = 34 * amp * Math.sin(2 * Math.PI * rnd(S(`wy${i}`), 0.5, 1.2) * lt + rnd(S(`py${i}`), 0, 6.28));
		const rz = rnd(S(`rz${i}`), -180, 180) + (rnd(S(`rzs${i}`)) < 0.5 ? -1 : 1) * p.spin * rnd(S(`rzv${i}`), 0.3, 1) * lt;
		const bend = curl * (rnd(S(`b0${i}`), -14, 14) + 26 * calm * Math.sin(2 * Math.PI * rnd(S(`wb${i}`), 0.8, 1.6) * lt + rnd(S(`pb${i}`), 0, 6.28)));
		const pop = mode === 'rain' ? 1 : 0.3 + 0.7 * ease.outCubic(clamp01(lt / 0.14));
		const light = (yaw: number) => {
			const n1 = Math.abs(Math.cos(rx * DEG) * Math.cos(yaw * DEG));
			return 0.7 + 0.3 * n1 + 0.08 * Math.sin(yaw * DEG);
		};
		const base = palette[i % palette.length];
		const dof = it.d > 0.3 ? (it.d - 0.3) * 7 * u : 0;
		const filters = [dof > 0.4 ? `blur(${dof.toFixed(2)}px)` : '', rigid ? `brightness(${light(ry).toFixed(3)})` : '', p.shadow && kind !== 'confetti' && it.d < 0.36 ? `drop-shadow(0 ${(8 * u).toFixed(1)}px ${(10 * u).toFixed(1)}px rgba(0,0,0,0.2))` : '']
			.filter(Boolean)
			.join(' ');
		const w = it.w;
		const content = (offset: number) => {
			if (kind === 'image') return <Img src={assetSrc(p.images[i % p.images.length])} style={{display: 'block', width: w, height: 'auto', marginLeft: offset, maxWidth: 'none'}} />;
			if (kind === 'note') return <div style={{marginLeft: offset}}><Note w={w} base={base} /></div>;
			return null;
		};
		let body: React.ReactNode;
		if (!rigid) {
			// two halves hinged in the middle: the paper bends as it flutters
			body = (
				<div style={{display: 'flex', transformStyle: 'preserve-3d'}}>
					{[1, -1].map((sd) => {
						const l = light(ry + sd * bend);
						return (
							<div
								key={sd}
								style={{
									position: 'relative',
									width: w / 2,
									overflow: 'hidden',
									transformOrigin: sd > 0 ? '100% 50%' : '0% 50%',
									transform: `rotateY(${(sd * bend).toFixed(2)}deg)`,
									// images may have alpha: shade with a filter; notes: a cheaper tint overlay
									filter: kind === 'image' ? `brightness(${l.toFixed(3)})` : undefined,
								}}
							>
								{content(sd > 0 ? 0 : -w / 2)}
								{kind !== 'image' ? <div style={{position: 'absolute', inset: 0, background: l < 1 ? `rgba(0,0,0,${(1 - l).toFixed(3)})` : `rgba(255,255,255,${(l - 1).toFixed(3)})`}} /> : null}
							</div>
						);
					})}
				</div>
			);
		} else if (kind === 'card') {
			body = <PayCard w={w} base={base} />;
		} else if (kind === 'coin') {
			body = <Coin d={w} base={base} />;
		} else if (kind === 'confetti') {
			body = <div style={{width: w, height: w * 1.7, borderRadius: w * 0.15, background: base}} />;
		} else {
			body = <div style={{fontFamily: EMOJI_STACK, fontSize: w, lineHeight: 1}}>{p.emojis[i % p.emojis.length]}</div>;
		}
		nodes.push(
			<Blurred key={i} mb={mb} x={x} y={y} box={it.box} dx={dx} dy={dy} strength={p.blur} innerStyle={{filter: filters || undefined, opacity: 1 - 0.18 * it.d}}>
				<div style={{transform: `perspective(${1300 * u}px) rotateZ(${rz.toFixed(2)}deg) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) scale(${pop.toFixed(3)})`, transformStyle: 'preserve-3d'}}>{body}</div>
			</Blurred>,
		);
	}
	return (
		<AbsoluteFill>
			<MotionBlurDefs mb={mb} />
			{nodes}
		</AbsoluteFill>
	);
};

export const imageRain = defineLook({
	id: 'image-rain',
	category: 'fx',
	kind: 'overlay',
	duration: 3.5,
	outro: 0.25,
	usesFont2: false,
	description:
		'Flat objects flying with 3D flutter (wobble, tumble, paper bend, spin), depth parallax and motion blur: rain from above across the width, a stream shot from a point like a money gun, or a fountain burst. Items: your images (PNG cut-outs), emojis, or procedural banknotes / cards / confetti / coins.',
	props,
	render: ImageRain,
});
