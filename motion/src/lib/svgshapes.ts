// SVG outline helpers: parse an SVG document (or raw path strings) into absolute, transform-baked path
// strings in the root viewBox space, split them into drawable pieces (subpaths with lengths), and sample
// evenly spread points inside the filled area (canvas Path2D + isPointInPath).
import {getBoundingBox, getLength, getSubpaths, parsePath, reduceInstructions, serializeInstructions, type ReducedInstruction} from '@remotion/paths';
import {rnd} from './anim';

export type FillRule = 'nonzero' | 'evenodd';
/** One shape: absolute path (M/L/C/Z only) in viewBox units. */
export type Shape = {d: string; rule: FillRule};
export type ViewBox = [number, number, number, number];
/** A drawable stroke piece (one subpath). */
export type Piece = {d: string; len: number; index: number};

type Mat = [number, number, number, number, number, number];
const ID: Mat = [1, 0, 0, 1, 0, 0];
const mul = (m: Mat, n: Mat): Mat => [
	m[0] * n[0] + m[2] * n[1],
	m[1] * n[0] + m[3] * n[1],
	m[0] * n[2] + m[2] * n[3],
	m[1] * n[2] + m[3] * n[3],
	m[0] * n[4] + m[2] * n[5] + m[4],
	m[1] * n[4] + m[3] * n[5] + m[5],
];

const parseTransform = (s: string | null): Mat => {
	let m = ID;
	if (!s) return m;
	const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
	let k: RegExpExecArray | null;
	while ((k = re.exec(s))) {
		const v = k[2].split(/[\s,]+/).filter(Boolean).map(Number);
		let n: Mat = ID;
		switch (k[1]) {
			case 'matrix':
				if (v.length >= 6) n = [v[0], v[1], v[2], v[3], v[4], v[5]];
				break;
			case 'translate':
				n = [1, 0, 0, 1, v[0] || 0, v[1] || 0];
				break;
			case 'scale':
				n = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
				break;
			case 'rotate': {
				const a = ((v[0] || 0) * Math.PI) / 180;
				const c = Math.cos(a);
				const sn = Math.sin(a);
				n = [c, sn, -sn, c, 0, 0];
				if (v.length >= 3) n = mul(mul([1, 0, 0, 1, v[1], v[2]], n), [1, 0, 0, 1, -v[1], -v[2]]);
				break;
			}
			case 'skewX':
				n = [1, 0, Math.tan(((v[0] || 0) * Math.PI) / 180), 1, 0, 0];
				break;
			case 'skewY':
				n = [1, Math.tan(((v[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
				break;
		}
		m = mul(m, n);
	}
	return m;
};

const isIdentity = (m: Mat) => m.every((v, i) => Math.abs(v - ID[i]) < 1e-12);

/** Absolute M/L/C/Z path with the matrix baked in ('' when the path cannot be parsed). */
export const normalizePathD = (d: string, m: Mat = ID): string => {
	let ins: ReducedInstruction[];
	try {
		ins = reduceInstructions(parsePath(d));
	} catch {
		return '';
	}
	if (!ins.length) return '';
	if (!isIdentity(m)) {
		const ap = (x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] as const;
		ins = ins.map((i) => {
			if (i.type === 'Z') return i;
			if (i.type === 'C') {
				const [cp1x, cp1y] = ap(i.cp1x, i.cp1y);
				const [cp2x, cp2y] = ap(i.cp2x, i.cp2y);
				const [x, y] = ap(i.x, i.y);
				return {type: 'C', cp1x, cp1y, cp2x, cp2y, x, y};
			}
			const [x, y] = ap(i.x, i.y);
			return {type: i.type, x, y};
		});
	}
	return serializeInstructions(ins);
};

const n = (el: Element, a: string, def = 0) => {
	const v = parseFloat(el.getAttribute(a) ?? '');
	return Number.isFinite(v) ? v : def;
};

const ellipseD = (cx: number, cy: number, rx: number, ry: number) =>
	`M${cx - rx},${cy} A${rx},${ry} 0 1,0 ${cx + rx},${cy} A${rx},${ry} 0 1,0 ${cx - rx},${cy} Z`;

const rectD = (x: number, y: number, w: number, h: number, rx0: number, ry0: number) => {
	let rx = rx0 || ry0;
	let ry = ry0 || rx0;
	rx = Math.min(rx, w / 2);
	ry = Math.min(ry, h / 2);
	if (rx <= 0 || ry <= 0) return `M${x},${y} H${x + w} V${y + h} H${x} Z`;
	return (
		`M${x + rx},${y} H${x + w - rx} A${rx},${ry} 0 0 1 ${x + w},${y + ry} V${y + h - ry} A${rx},${ry} 0 0 1 ${x + w - rx},${y + h} ` +
		`H${x + rx} A${rx},${ry} 0 0 1 ${x},${y + h - ry} V${y + ry} A${rx},${ry} 0 0 1 ${x + rx},${y} Z`
	);
};

const pointsD = (pts: string, close: boolean) => {
	const v = pts.trim().split(/[\s,]+/).filter(Boolean).map(Number);
	if (v.length < 4) return '';
	let d = `M${v[0]},${v[1]}`;
	for (let i = 2; i + 1 < v.length; i += 2) d += ` L${v[i]},${v[i + 1]}`;
	return close ? `${d} Z` : d;
};

const SKIP = new Set(['defs', 'clippath', 'mask', 'symbol', 'style', 'title', 'desc', 'metadata', 'pattern', 'lineargradient', 'radialgradient', 'text', 'image', 'use', 'marker', 'filter', 'script', 'foreignobject']);

const styleProp = (el: Element, name: string): string | null => {
	const st = el.getAttribute('style');
	if (st) {
		const m = st.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`));
		if (m) return m[1].trim();
	}
	return el.getAttribute(name);
};

const inheritedRule = (el: Element | null): FillRule => {
	for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
		const v = styleProp(e, 'fill-rule');
		if (v === 'evenodd' || v === 'nonzero') return v;
	}
	return 'nonzero';
};

/** Parse SVG markup into transform-baked shapes in the root viewBox space. */
export const parseSvgMarkup = (text: string): {viewBox: ViewBox | null; shapes: Shape[]} => {
	const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
	const root = doc.documentElement;
	if (!root || root.nodeName.toLowerCase() !== 'svg') throw new Error('line-draw: the svg file has no <svg> root');
	const shapes: Shape[] = [];
	const walk = (el: Element, m: Mat) => {
		const tag = el.nodeName.toLowerCase().replace(/^svg:/, '');
		if (SKIP.has(tag)) return;
		if (styleProp(el, 'display') === 'none') return;
		const mm = el === root ? m : mul(m, parseTransform(el.getAttribute('transform')));
		let d = '';
		switch (tag) {
			case 'path':
				d = el.getAttribute('d') ?? '';
				break;
			case 'polygon':
				d = pointsD(el.getAttribute('points') ?? '', true);
				break;
			case 'polyline':
				d = pointsD(el.getAttribute('points') ?? '', false);
				break;
			case 'line':
				d = `M${n(el, 'x1')},${n(el, 'y1')} L${n(el, 'x2')},${n(el, 'y2')}`;
				break;
			case 'rect':
				if (n(el, 'width') > 0 && n(el, 'height') > 0) d = rectD(n(el, 'x'), n(el, 'y'), n(el, 'width'), n(el, 'height'), n(el, 'rx'), n(el, 'ry'));
				break;
			case 'circle':
				if (n(el, 'r') > 0) d = ellipseD(n(el, 'cx'), n(el, 'cy'), n(el, 'r'), n(el, 'r'));
				break;
			case 'ellipse':
				if (n(el, 'rx') > 0 && n(el, 'ry') > 0) d = ellipseD(n(el, 'cx'), n(el, 'cy'), n(el, 'rx'), n(el, 'ry'));
				break;
		}
		if (d.trim()) {
			const nd = normalizePathD(d, mm);
			if (nd) shapes.push({d: nd, rule: inheritedRule(el)});
		}
		for (const c of Array.from(el.children)) walk(c, mm);
	};
	walk(root, ID);
	const vbAttr = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
	let viewBox: ViewBox | null = null;
	if (vbAttr.length === 4 && vbAttr.every(Number.isFinite) && vbAttr[2] > 0 && vbAttr[3] > 0) viewBox = vbAttr as ViewBox;
	else if (n(root, 'width') > 0 && n(root, 'height') > 0) viewBox = [0, 0, n(root, 'width'), n(root, 'height')];
	return {viewBox, shapes};
};

/** Bounding box of shapes as a viewBox (with a margin fraction). */
export const shapesBox = (shapes: Shape[], margin = 0.04): ViewBox => {
	let x1 = Infinity;
	let y1 = Infinity;
	let x2 = -Infinity;
	let y2 = -Infinity;
	for (const s of shapes) {
		try {
			const b = getBoundingBox(s.d);
			x1 = Math.min(x1, b.x1);
			y1 = Math.min(y1, b.y1);
			x2 = Math.max(x2, b.x2);
			y2 = Math.max(y2, b.y2);
		} catch {
			// ignore unparsable
		}
	}
	if (!Number.isFinite(x1)) return [0, 0, 100, 100];
	const w = Math.max(1e-6, x2 - x1);
	const h = Math.max(1e-6, y2 - y1);
	const m = Math.max(w, h) * margin;
	return [x1 - m, y1 - m, w + 2 * m, h + 2 * m];
};

/** Split shapes into subpaths with their lengths (zero-length pieces dropped). */
export const shapesToPieces = (shapes: Shape[]): Piece[] => {
	const out: Piece[] = [];
	for (const s of shapes) {
		let subs: string[];
		try {
			subs = getSubpaths(s.d);
		} catch {
			subs = [s.d];
		}
		for (const d of subs) {
			let len = 0;
			try {
				len = getLength(d);
			} catch {
				len = 0;
			}
			if (len > 1e-6) out.push({d, len, index: out.length});
		}
	}
	return out;
};

/**
 * Evenly spread points inside the union of `shapes` (best-candidate sampling, deterministic).
 * `margin` (viewBox units): points keep this distance from the outline (checked on 8 directions).
 */
export const samplePointsInside = (shapes: Shape[], count: number, margin: number, seed: string): {x: number; y: number}[] => {
	if (count <= 0 || !shapes.length || typeof document === 'undefined') return [];
	const ctx = document.createElement('canvas').getContext('2d');
	if (!ctx) return [];
	const paths = shapes.map((s) => ({p: new Path2D(s.d), rule: s.rule}));
	const [bx, by, bw, bh] = shapesBox(shapes, 0);
	const inside = (x: number, y: number) => paths.some((q) => ctx.isPointInPath(q.p, x, y, q.rule));
	const ok = (x: number, y: number) => {
		if (!inside(x, y)) return false;
		if (margin <= 0) return true;
		for (let k = 0; k < 8; k++) {
			const a = (k / 8) * Math.PI * 2;
			if (!inside(x + Math.cos(a) * margin, y + Math.sin(a) * margin)) return false;
		}
		return true;
	};
	const pts: {x: number; y: number}[] = [];
	let tries = 0;
	for (let i = 0; i < count; i++) {
		let best: {x: number; y: number} | null = null;
		let bestD = -1;
		let cands = 0;
		for (let k = 0; k < 400 && cands < 16; k++) {
			tries++;
			const c = {x: bx + rnd(`${seed}x${tries}`) * bw, y: by + rnd(`${seed}y${tries}`) * bh};
			if (!ok(c.x, c.y)) continue;
			cands++;
			let dmin = Infinity;
			for (const q of pts) dmin = Math.min(dmin, (q.x - c.x) ** 2 + (q.y - c.y) ** 2);
			if (dmin > bestD) {
				bestD = dmin;
				best = c;
			}
		}
		if (!best) break;
		pts.push(best);
	}
	return pts;
};
