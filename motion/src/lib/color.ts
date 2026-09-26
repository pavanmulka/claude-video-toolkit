// Colour helpers (inputs: #rgb, #rrggbb, #rrggbbaa or rgb()/rgba()).
export type RGB = {r: number; g: number; b: number; a: number};

export const parseColor = (c: string): RGB => {
	const s = (c || '').trim();
	if (s.startsWith('#')) {
		let h = s.slice(1);
		if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
		const n = parseInt(h.slice(0, 6), 16);
		const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
		return {r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a};
	}
	const m = s.match(/rgba?\(([^)]+)\)/i);
	if (m) {
		const [r, g, b, a] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
		return {r, g, b, a: a === undefined || Number.isNaN(a) ? 1 : a};
	}
	return {r: 255, g: 255, b: 255, a: 1};
};

export const rgba = (c: string, alpha = 1) => {
	const {r, g, b, a} = parseColor(c);
	return `rgba(${r},${g},${b},${+(a * alpha).toFixed(4)})`;
};

export const mix = (c1: string, c2: string, t: number) => {
	const a = parseColor(c1);
	const b = parseColor(c2);
	const m = (x: number, y: number) => Math.round(x + (y - x) * t);
	return `rgba(${m(a.r, b.r)},${m(a.g, b.g)},${m(a.b, b.b)},${+(a.a + (b.a - a.a) * t).toFixed(4)})`;
};

/** Relative luminance 0..1 */
export const luminance = (c: string) => {
	const {r, g, b} = parseColor(c);
	const f = (v: number) => {
		const x = v / 255;
		return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

/** Readable text colour on top of `bgColor`: dark for light backgrounds, white otherwise. */
export const onColor = (bgColor: string, dark = '#0B0710', light = '#FFFFFF') => (luminance(bgColor) > 0.42 ? dark : light);

/** Soft glow text-shadow. */
export const glowShadow = (color: string, intensity: number, u: number, spread = 1) => {
	if (intensity <= 0.001) return 'none';
	return [
		`0 0 ${8 * u * spread}px ${rgba(color, 0.55 * intensity)}`,
		`0 0 ${26 * u * spread}px ${rgba(color, 0.45 * intensity)}`,
		`0 0 ${64 * u * spread}px ${rgba(color, 0.3 * intensity)}`,
	].join(', ');
};

/** Dark soft shadow that keeps light text legible over busy video. */
export const liftShadow = (u: number, strength = 0.35) => `0 ${4 * u}px ${18 * u}px rgba(0,0,0,${strength})`;
