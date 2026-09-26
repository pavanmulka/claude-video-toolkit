// Reusable motion-graphics primitives (all driven by explicit time values; deterministic).
import React from 'react';
import {breathe, clamp01, ease, prog, rnd} from './anim';
import {rgba} from './color';

/** Radial speed lines bursting outward from (cx, cy) at time t0. SVG covering the frame. */
export const SpeedLines: React.FC<{
	t: number;
	t0: number;
	cx: number;
	cy: number;
	W: number;
	H: number;
	u: number;
	count: number;
	r0: number;
	colors: string[];
	seed?: string;
	life?: number;
	intensity?: number;
}> = ({t, t0, cx, cy, W, H, u, count, r0, colors, seed = 'sl', life = 0.55, intensity = 1}) => {
	const p = (t - t0) / life;
	if (p <= 0 || p >= 1 || count <= 0) return null;
	const reach = Math.max(W, H) * 0.5;
	const polys: React.ReactNode[] = [];
	for (let k = 0; k < count; k++) {
		const a = (k / count) * Math.PI * 2 + rnd(`${seed}a${k}`, -0.12, 0.12);
		const start = r0 * rnd(`${seed}s${k}`, 0.9, 1.45);
		const speed = rnd(`${seed}v${k}`, 0.55, 1.1);
		const lp = clamp01(p * rnd(`${seed}p${k}`, 0.95, 1.3));
		if (lp >= 1) continue;
		const head = start + reach * speed * ease.outQuart(lp);
		const lmax = reach * rnd(`${seed}l${k}`, 0.1, 0.26);
		const len = lmax * Math.pow(1 - lp, 0.8) * Math.min(1, lp * 7);
		const tail = head - len;
		if (len < 2) continue;
		const wOut = rnd(`${seed}w${k}`, 4, 11) * u * (1 - 0.45 * lp);
		const wIn = wOut * 0.12;
		const c = Math.cos(a);
		const s = Math.sin(a);
		const px = -s;
		const py = c;
		const pts = [
			[cx + c * tail + (px * wIn) / 2, cy + s * tail + (py * wIn) / 2],
			[cx + c * (head - wOut) + (px * wOut) / 2, cy + s * (head - wOut) + (py * wOut) / 2],
			[cx + c * head, cy + s * head],
			[cx + c * (head - wOut) - (px * wOut) / 2, cy + s * (head - wOut) - (py * wOut) / 2],
			[cx + c * tail - (px * wIn) / 2, cy + s * tail - (py * wIn) / 2],
		]
			.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
			.join(' ');
		const col = colors[Math.floor(rnd(`${seed}c${k}`, 0, colors.length))];
		const o = Math.pow(1 - lp, 1.1) * rnd(`${seed}o${k}`, 0.6, 1) * intensity;
		polys.push(<polygon key={k} points={pts} fill={col} opacity={o} />);
	}
	return (
		<svg width={W} height={H} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
			{polys}
		</svg>
	);
};

/** Expanding ring + soft flash at (cx, cy). */
export const Shockwave: React.FC<{
	t: number;
	t0: number;
	cx: number;
	cy: number;
	W: number;
	H: number;
	u: number;
	r0: number;
	reach: number;
	color: string;
	width?: number;
	life?: number;
	flash?: number;
}> = ({t, t0, cx, cy, W, H, u, r0, reach, color, width = 12, life = 0.55, flash = 0.5}) => {
	const p = (t - t0) / life;
	if (p <= 0 || p >= 1) return null;
	const r = r0 + reach * ease.outQuart(p);
	const id = `flash${Math.round(cx)}${Math.round(cy)}${Math.round(t0 * 100)}`;
	return (
		<svg width={W} height={H} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
			<defs>
				<radialGradient id={id}>
					<stop offset="0%" stopColor={color} stopOpacity={0.9} />
					<stop offset="100%" stopColor={color} stopOpacity={0} />
				</radialGradient>
			</defs>
			<defs>
				<filter id={`${id}b`} x="-50%" y="-50%" width="200%" height="200%">
					<feGaussianBlur stdDeviation={6 * u} />
				</filter>
			</defs>
			{flash > 0 ? <circle cx={cx} cy={cy} r={r0 * (1 + 0.6 * p)} fill={`url(#${id})`} opacity={flash * Math.pow(1 - p, 2)} /> : null}
			<circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={width * 2.4 * u * (1 - p) + 1} opacity={0.5 * Math.pow(1 - p, 1.5)} filter={`url(#${id}b)`} />
			<circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={width * 0.5 * u * (1 - p) + 0.5} opacity={0.8 * Math.pow(1 - p, 1.6)} />
		</svg>
	);
};

const STAR = 'M0,-1 C0.12,-0.12 0.12,-0.12 1,0 C0.12,0.12 0.12,0.12 0,1 C-0.12,0.12 -0.12,0.12 -1,0 C-0.12,-0.12 -0.12,-0.12 0,-1 Z';

/** Twinkling 4-point sparkle. */
export const Sparkle: React.FC<{x: number; y: number; size: number; color: string; opacity?: number; rotate?: number}> = ({
	x,
	y,
	size,
	color,
	opacity = 1,
	rotate = 0,
}) => {
	if (size <= 0.2 || opacity <= 0.01) return null;
	return (
		<svg
			width={size * 2}
			height={size * 2}
			viewBox="-1.2 -1.2 2.4 2.4"
			style={{position: 'absolute', left: x - size, top: y - size, overflow: 'visible', opacity, transform: `rotate(${rotate}deg)`, filter: `drop-shadow(0 0 ${size * 0.5}px ${rgba(color, 0.9)})`}}
		>
			<path d={STAR} fill={color} />
			<circle r={0.16} fill="#FFFFFF" />
		</svg>
	);
};

/** A field of sparkles scattered around a box that twinkle forever after `t0`. */
export const SparkleField: React.FC<{
	t: number;
	t0: number;
	cx: number;
	cy: number;
	w: number;
	h: number;
	u: number;
	count: number;
	colors: string[];
	seed?: string;
	size?: number;
}> = ({t, t0, cx, cy, w, h, u, count, colors, seed = 'spk', size = 16}) => {
	if (t < t0) return null;
	const items: React.ReactNode[] = [];
	for (let i = 0; i < count; i++) {
		const ang = (i / count) * Math.PI * 2 + rnd(`${seed}a${i}`, -0.35, 0.35);
		const rad = rnd(`${seed}r${i}`, 0.95, 1.2);
		const x = cx + Math.cos(ang) * (w / 2 + 30 * u) * rad;
		const y = cy + Math.sin(ang) * (h / 2 + 40 * u) * rad;
		const period = rnd(`${seed}p${i}`, 1.2, 2.2);
		const phase = rnd(`${seed}f${i}`, 0, 1);
		const tw = Math.pow(Math.max(0, Math.sin(((t - t0) / period + phase) * Math.PI * 2)), 3);
		const intro = prog(t, t0 + i * 0.05, t0 + i * 0.05 + 0.3);
		items.push(
			<Sparkle
				key={i}
				x={x}
				y={y}
				size={size * u * rnd(`${seed}s${i}`, 0.6, 1.2) * (0.4 + 0.6 * tw) * intro}
				color={colors[i % colors.length]}
				opacity={0.25 + 0.75 * tw}
				rotate={(t - t0) * 40 * (i % 2 ? 1 : -1)}
			/>,
		);
	}
	return <>{items}</>;
};

/** Diagonal light sweep; put inside a positioned element with overflow:hidden. p: 0..1 */
export const ShineBand: React.FC<{p: number; opacity?: number; width?: number; angle?: number}> = ({p, opacity = 0.55, width = 0.28, angle = 20}) => {
	if (p <= 0 || p >= 1) return null;
	const x = -60 + 220 * p;
	return (
		<div
			style={{
				position: 'absolute',
				top: '-50%',
				bottom: '-50%',
				left: `${x - width * 50}%`,
				width: `${width * 100}%`,
				transform: `skewX(${-angle}deg)`,
				background: `linear-gradient(90deg, transparent 0%, rgba(255,255,255,${opacity * 0.5}) 35%, rgba(255,255,255,${opacity}) 50%, rgba(255,255,255,${opacity * 0.5}) 65%, transparent 100%)`,
				pointerEvents: 'none',
				mixBlendMode: 'normal',
			}}
		/>
	);
};

/** Repeating shine: sweep every `every` seconds starting at t0. */
export const shineProgress = (t: number, t0: number, every: number, dur = 0.75) => {
	if (t < t0) return 0;
	const local = (t - t0) % every;
	return local < dur ? ease.inOutCubic(local / dur) : 0;
};

/** Radar ping ring around a rounded element (use as absolutely positioned sibling). */
export const PingRing: React.FC<{p: number; color: string; radius: number | string; spread: number; width: number}> = ({p, color, radius, spread, width}) => {
	if (p <= 0 || p >= 1) return null;
	return (
		<div
			style={{
				position: 'absolute',
				inset: -spread * ease.outCubic(p),
				borderRadius: radius,
				border: `${width * (1 - p) + 0.5}px solid ${rgba(color, 0.8 * (1 - p))}`,
				pointerEvents: 'none',
			}}
		/>
	);
};

/** Check mark drawn with stroke dash (p: 0..1) inside a circle that fills when done. */
export const CheckBadge: React.FC<{p: number; size: number; color: string; ink: string; ring?: string}> = ({p, size, color, ink, ring}) => {
	const ringP = clamp01(p / 0.45);
	const tickP = clamp01((p - 0.35) / 0.5);
	const fill = clamp01((p - 0.3) / 0.3);
	const C = 2 * Math.PI * 22;
	const tickLen = 30;
	return (
		<svg width={size} height={size} viewBox="0 0 50 50" style={{overflow: 'visible', display: 'block'}}>
			<circle cx={25} cy={25} r={22} fill={rgba(color, fill)} />
			<circle
				cx={25}
				cy={25}
				r={22}
				fill="none"
				stroke={ring ?? color}
				strokeWidth={3}
				strokeDasharray={C}
				strokeDashoffset={C * (1 - ringP)}
				transform="rotate(-90 25 25)"
				strokeLinecap="round"
			/>
			<path
				d="M15,26 L22,33 L36,18"
				fill="none"
				stroke={ink}
				strokeWidth={4.5}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeDasharray={tickLen}
				strokeDashoffset={tickLen * (1 - tickP)}
			/>
		</svg>
	);
};

/** Soft glowing blob (radial gradient div). */
export const GlowBlob: React.FC<{x: number; y: number; w: number; h: number; color: string; opacity: number}> = ({x, y, w, h, color, opacity}) => (
	<div
		style={{
			position: 'absolute',
			left: x - w / 2,
			top: y - h / 2,
			width: w,
			height: h,
			borderRadius: '50%',
			background: `radial-gradient(closest-side, ${rgba(color, opacity)} 0%, ${rgba(color, opacity * 0.45)} 45%, transparent 100%)`,
			pointerEvents: 'none',
		}}
	/>
);

export {breathe};
