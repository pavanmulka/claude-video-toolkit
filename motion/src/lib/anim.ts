import {Easing, interpolate, random, spring, type SpringConfig} from 'remotion';

export const SPRINGS = {
	snappy: {damping: 16, stiffness: 190, mass: 0.8},
	bouncy: {damping: 10, stiffness: 170, mass: 0.9},
	pop: {damping: 12, stiffness: 240, mass: 0.7},
	smooth: {damping: 22, stiffness: 110, mass: 1},
	gentle: {damping: 26, stiffness: 70, mass: 1},
	slam: {damping: 15, stiffness: 420, mass: 0.7},
	drop: {damping: 13, stiffness: 200, mass: 1},
} satisfies Record<string, Partial<SpringConfig>>;

/** Spring that starts at `startSec` (0 before). */
export const sp = (frame: number, fps: number, startSec: number, config: Partial<SpringConfig> = SPRINGS.snappy, durationInFrames?: number) =>
	spring({frame: frame - Math.round(startSec * fps), fps, config, durationInFrames});

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Normalised progress of t through [a, b], clamped, with optional easing. */
export const prog = (t: number, a: number, b: number, easing: (x: number) => number = (x) => x) =>
	easing(clamp01(b === a ? (t >= b ? 1 : 0) : (t - a) / (b - a)));

export const ease = {
	outCubic: Easing.out(Easing.cubic),
	inCubic: Easing.in(Easing.cubic),
	inOutCubic: Easing.inOut(Easing.cubic),
	outQuart: Easing.bezier(0.25, 1, 0.5, 1),
	outExpo: Easing.bezier(0.16, 1, 0.3, 1),
	inOutExpo: Easing.bezier(0.87, 0, 0.13, 1),
	outBack: Easing.out(Easing.back(1.7)),
	inQuad: Easing.in(Easing.quad),
	inOutSine: Easing.inOut(Easing.sin),
	outSine: Easing.out(Easing.sin),
};

export const map = (x: number, input: number[], output: number[], easing?: (x: number) => number) =>
	interpolate(x, input, output, {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing});

/** Deterministic random in [a, b). */
export const rnd = (seed: string | number, a = 0, b = 1) => a + random(seed) * (b - a);

/** Decaying camera shake after each impact time. Returns px offsets + degrees. */
export const shake = (t: number, impacts: number[], amp: number, seed = 'shake') => {
	let x = 0;
	let y = 0;
	let r = 0;
	impacts.forEach((t0, i) => {
		const dt = t - t0;
		if (dt < 0 || dt > 0.6) return;
		const a = amp * Math.exp(-dt / 0.085);
		const f = 2 * Math.PI * 19;
		x += a * Math.sin(dt * f + rnd(`${seed}x${i}`, 0, 6.28));
		y += a * 0.8 * Math.sin(dt * f * 1.13 + rnd(`${seed}y${i}`, 0, 6.28));
		r += a * 0.045 * Math.sin(dt * f * 0.9 + rnd(`${seed}r${i}`, 0, 6.28));
	});
	return {x, y, r};
};

/** Smooth 0..1 "breathing" wave. */
export const breathe = (t: number, period = 2.4, phase = 0) => 0.5 - 0.5 * Math.cos(((t / period) * 2 + phase) * Math.PI);

export const fmtTime = (secs: number, forceHours = false) => {
	const s = Math.max(0, Math.floor(secs + 1e-6));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = String(s % 60).padStart(2, '0');
	return h > 0 || forceHours ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

export type NumberFormat = 'integer' | 'decimal' | 'percent' | 'currency' | 'time' | 'compact';

/** Number of decimals written in a value (118 -> 0, 4.5 -> 1, 0.25 -> 2). */
export const decimalsOf = (v: number) => {
	if (!Number.isFinite(v)) return 0;
	const s = String(v);
	if (/e/i.test(s)) return 0;
	const i = s.indexOf('.');
	return i < 0 ? 0 : Math.min(6, s.length - i - 1);
};

/** decimals < 0 = automatic: as many decimals as the target value has (compact: of the compacted value). */
export const resolveDecimals = (decimals: number, to: number, format: NumberFormat) => {
	if (decimals >= 0) return decimals;
	if (format === 'time' || format === 'integer') return 0;
	if (format === 'compact') {
		const a = Math.abs(to);
		const div = a >= 1e9 ? 1e9 : a >= 1e6 ? 1e6 : a >= 1e3 ? 1e3 : 1;
		return Math.min(2, decimalsOf(+(to / div).toFixed(2)));
	}
	return decimalsOf(to);
};

export const formatNumber = (
	v: number,
	o: {format: NumberFormat; decimals?: number; currency?: string; separator?: string; prefix?: string; suffix?: string},
) => {
	const sep = o.separator ?? ',';
	const group = (s: string) => {
		const [i, d] = s.split('.');
		const neg = i.startsWith('-');
		const digits = neg ? i.slice(1) : i;
		const g = digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
		return (neg ? '-' : '') + g + (d !== undefined ? `.${d}` : '');
	};
	let body: string;
	switch (o.format) {
		case 'time':
			body = fmtTime(v);
			break;
		case 'decimal':
			body = group(v.toFixed(o.decimals ?? 1));
			break;
		case 'percent':
			body = `${group(v.toFixed(o.decimals ?? 0))}%`;
			break;
		case 'currency':
			body = `${o.currency ?? '$'}${group(v.toFixed(o.decimals ?? 0))}`;
			break;
		case 'compact': {
			const a = Math.abs(v);
			const [div, unit] = a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'K'] : [1, ''];
			body = `${(v / div).toFixed(unit ? (o.decimals ?? 1) : 0)}${unit}`;
			break;
		}
		default:
			body = group(String(Math.round(v)));
	}
	return `${o.prefix ?? ''}${body}${o.suffix ?? ''}`;
};
