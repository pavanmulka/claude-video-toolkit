// line-draw: an outline drawing draws itself on (stroke-dashoffset), an optional flat fill fades in, then
// optional dots / tiny phone icons / pins / emojis pop in at evenly spread points INSIDE the shape
// ("in every home across the country"). Built-in outlines, raw path strings, or any .svg file (a map).
import React, {useEffect, useMemo, useState} from 'react';
import {AbsoluteFill, cancelRender, continueRender, delayRender, Easing, useCurrentFrame} from 'remotion';
import {SPRINGS, clamp01, ease, prog, rnd, sp} from '../lib/anim';
import {EMOJI_STACK} from '../lib/fonts';
import {assetSrc, defineLook, useLook, type LookProps} from '../lib/look';
import {asset, int, num, oneOf, str, strList} from '../lib/schema';
import {normalizePathD, parseSvgMarkup, samplePointsInside, shapesBox, shapesToPieces, type Shape, type ViewBox} from '../lib/svgshapes';

const SHAPE_IDS = ['house', 'heart', 'phone', 'document', 'globe', 'cloud', 'shield', 'star', 'pin', 'folder'] as const;
type ShapeId = (typeof SHAPE_IDS)[number];

const starD = (() => {
	const pts: string[] = [];
	for (let i = 0; i < 10; i++) {
		const a = -Math.PI / 2 + (i * Math.PI) / 5;
		const r = i % 2 ? 18.5 : 44;
		pts.push(`${(50 + r * Math.cos(a)).toFixed(2)},${(54 + r * Math.sin(a)).toFixed(2)}`);
	}
	return `M${pts.join(' L')} Z`;
})();

/** Built-in outlines in a 0 0 100 100 box: `stroke` = lines drawn (outline first), `area` = silhouette (fill + dots). */
const BUILTIN: Record<ShapeId, {stroke: string[]; area: string[]; rule?: 'evenodd'}> = {
	house: {
		stroke: [
			'M11,47 L50,14 L89,47',
			'M21,39 L21,87 L79,87 L79,39',
			'M55,87 L55,67 Q55,63 59,63 L64,63 Q68,63 68,67 L68,87',
			'M31,55 L44,55 L44,68 L31,68 Z',
			'M37.5,55 L37.5,68 M31,61.5 L44,61.5',
			'M66,27.5 L66,19 L74,19 L74,34.3',
		],
		area: ['M50,14 L79,38.5 L79,87 L21,87 L21,38.5 Z'],
	},
	heart: {
		stroke: ['M50,86 C47,83 9,60 9,34 C9,21 19,13 30,13 C39,13 46,18 50,26 C54,18 61,13 70,13 C81,13 91,21 91,34 C91,60 53,83 50,86 Z'],
		area: ['M50,86 C47,83 9,60 9,34 C9,21 19,13 30,13 C39,13 46,18 50,26 C54,18 61,13 70,13 C81,13 91,21 91,34 C91,60 53,83 50,86 Z'],
	},
	phone: {
		stroke: ['M37,6 L63,6 Q73,6 73,16 L73,84 Q73,94 63,94 L37,94 Q27,94 27,84 L27,16 Q27,6 37,6 Z', 'M44,13.5 L56,13.5', 'M43,87 L57,87'],
		area: ['M37,6 L63,6 Q73,6 73,16 L73,84 Q73,94 63,94 L37,94 Q27,94 27,84 L27,16 Q27,6 37,6 Z'],
	},
	document: {
		stroke: ['M25,7 L61,7 L77,23 L77,93 L25,93 Z', 'M61,7 L61,23 L77,23', 'M35,41 L67,41', 'M35,53 L67,53', 'M35,65 L67,65', 'M35,77 L54,77'],
		area: ['M25,7 L61,7 L77,23 L77,93 L25,93 Z'],
	},
	globe: {
		stroke: [
			'M9,50 A41,41 0 1,0 91,50 A41,41 0 1,0 9,50 Z',
			'M50,9 A17,41 0 1,0 50,91 A17,41 0 1,0 50,9 Z',
			'M9,50 L91,50',
			'M14.8,29 L85.2,29',
			'M14.8,71 L85.2,71',
			'M50,9 L50,91',
		],
		area: ['M9,50 A41,41 0 1,0 91,50 A41,41 0 1,0 9,50 Z'],
	},
	cloud: {
		stroke: ['M29,76 C17,76 8,68 8,57 C8,46 17,38 28,38 C30,26 39,18 51,18 C63,18 72,26 74,37 C85,38 92,46 92,57 C92,68 84,76 73,76 Z'],
		area: ['M29,76 C17,76 8,68 8,57 C8,46 17,38 28,38 C30,26 39,18 51,18 C63,18 72,26 74,37 C85,38 92,46 92,57 C92,68 84,76 73,76 Z'],
	},
	shield: {
		stroke: ['M50,7 L85,19 L85,45 C85,68 70,84 50,93 C30,84 15,68 15,45 L15,19 Z', 'M35,50 L46,61 L67,39'],
		area: ['M50,7 L85,19 L85,45 C85,68 70,84 50,93 C30,84 15,68 15,45 L15,19 Z'],
	},
	star: {stroke: [starD], area: [starD]},
	pin: {
		stroke: ['M50,94 C50,94 19,61 19,38 C19,20 33,7 50,7 C67,7 81,20 81,38 C81,61 50,94 50,94 Z', 'M38,37 A12,12 0 1,0 62,37 A12,12 0 1,0 38,37 Z'],
		area: ['M50,94 C50,94 19,61 19,38 C19,20 33,7 50,7 C67,7 81,20 81,38 C81,61 50,94 50,94 Z M38,37 A12,12 0 1,0 62,37 A12,12 0 1,0 38,37 Z'],
		rule: 'evenodd',
	},
	folder: {
		stroke: ['M9,27 Q9,20 16,20 L38,20 L46,28 L84,28 Q91,28 91,35 L91,78 Q91,85 84,85 L16,85 Q9,85 9,78 Z', 'M9,40 L91,40'],
		area: ['M9,27 Q9,20 16,20 L38,20 L46,28 L84,28 Q91,28 91,35 L91,78 Q91,85 84,85 L16,85 Q9,85 9,78 Z'],
	},
};

const props = {
	svg: asset('An .svg file to draw (a map, a logo outline...): every <path>, <polygon>, <polyline>, <circle>, <ellipse>, <rect>, <line> is drawn in its viewBox; inline <svg> markup also works', ''),
	paths: strList([], 'Raw SVG path strings (d) to draw instead of a built-in shape (used when svg is empty)'),
	viewBox: str('', 'viewBox for `paths` ("0 0 100 100"); empty = fit the paths'),
	shape: oneOf(SHAPE_IDS, 'house', 'Built-in outline when svg and paths are empty: house | heart | phone | document | globe | cloud | shield | star | pin | folder'),
	strokeWidth: num(5, 'Line width (design units)', 0.2, 80),
	color: str('', 'Line colour; empty = theme.fg'),
	start: num(0.1, 'Seconds before the drawing starts', 0, 60),
	drawDuration: num(1, 'Seconds to draw the whole outline', 0.05, 60),
	stagger: num(0.1, 'Seconds between pieces (subpaths) starting to draw; capped so all start within 45 % of drawDuration', 0, 5),
	order: oneOf(['size', 'document'] as const, 'size', 'Drawing order of the pieces: size (longest first: outline, then details) | document (file order)'),
	size: num(0.84, 'Drawing width as a fraction of the frame width', 0.05, 3),
	maxHeight: num(0.56, 'Maximum drawing height as a fraction of the frame height', 0.05, 3),
	x: num(0.5, 'Horizontal centre (fraction of width)', -1, 2),
	y: num(0.5, 'Vertical centre (fraction of height)', -1, 2),
	fillOpacity: num(0, 'Flat fill faded in after drawing (0 = outline only)', 0, 1),
	fillColor: str('', 'Fill colour; empty = the line colour'),
	dots: int(0, 'Number of dots / icons popping in inside the shape (0 = none)', 0, 600),
	dotStyle: oneOf(['dot', 'phone', 'emoji', 'pin'] as const, 'phone', 'dot (filled circle) | phone (tiny rounded-rect phone outline) | emoji (dotEmoji) | pin (map pin)'),
	dotEmoji: str('📱', 'Emoji for dotStyle=emoji'),
	dotColor: str('', 'Dot / icon colour; empty = theme.accent'),
	dotSize: num(30, 'Dot / icon height (design units)', 2, 300),
	dotStagger: num(0.035, 'Seconds between dots popping in', 0, 2),
	dotsAt: num(-1, 'Seconds when the first dot pops; -1 = when the outline is ~85 % drawn', -1, 60),
	dotSeed: int(1, 'Random seed for dot positions', 0, 1e6),
};

type P = LookProps<typeof props>;

/** Loads the svg prop (file / URL / inline markup) once; blocks rendering until it is there. */
const useSvgText = (svg: string): string | null => {
	const inline = svg.trim().startsWith('<');
	const [handle] = useState(() => (svg && !inline ? delayRender(`line-draw: loading ${svg}`, {timeoutInMilliseconds: 60000}) : null));
	const [text, setText] = useState<string | null>(inline ? svg : null);
	useEffect(() => {
		if (handle === null) return;
		let alive = true;
		fetch(assetSrc(svg))
			.then((r) => {
				if (!r.ok) throw new Error(`line-draw: cannot load svg "${svg}" (HTTP ${r.status})`);
				return r.text();
			})
			.then((tx) => {
				if (!alive) return;
				setText(tx);
				continueRender(handle);
			})
			.catch((e) => cancelRender(e));
		return () => {
			alive = false;
		};
	}, [svg, handle]);
	return text;
};

const drawEase = Easing.bezier(0.35, 0, 0.2, 1);

const PhoneIcon: React.FC<{h: number; color: string}> = ({h, color}) => {
	const w = h * 0.6;
	const sw = Math.max(1.4, h * 0.085);
	return (
		<svg width={w + sw} height={h + sw} viewBox={`${-sw / 2} ${-sw / 2} ${w + sw} ${h + sw}`} style={{display: 'block', overflow: 'visible'}}>
			<rect x={0} y={0} width={w} height={h} rx={h * 0.13} fill="none" stroke={color} strokeWidth={sw} />
			<line x1={w * 0.38} y1={h * 0.1} x2={w * 0.62} y2={h * 0.1} stroke={color} strokeWidth={sw * 0.9} strokeLinecap="round" />
		</svg>
	);
};

const PinIcon: React.FC<{h: number; color: string}> = ({h, color}) => (
	<svg width={h * 0.75} height={h} viewBox="0 0 24 32" style={{display: 'block', overflow: 'visible'}}>
		<path d="M12,31 C12,31 2,19 2,11.5 C2,5.7 6.5,1.5 12,1.5 C17.5,1.5 22,5.7 22,11.5 C22,19 12,31 12,31 Z" fill={color} />
		<circle cx={12} cy={11.5} r={4.2} fill="#FFFFFF" />
	</svg>
);

const LineDraw: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const svgText = useSvgText(p.svg);
	const pathsKey = JSON.stringify(p.paths);

	const geo = useMemo(() => {
		let stroke: Shape[];
		let area: Shape[];
		let vb: ViewBox | null = null;
		if (p.svg) {
			if (svgText === null) return null;
			const parsed = parseSvgMarkup(svgText);
			stroke = parsed.shapes;
			area = parsed.shapes;
			vb = parsed.viewBox;
		} else if (p.paths.length) {
			stroke = p.paths.map((d) => ({d: normalizePathD(d), rule: 'nonzero' as const})).filter((s) => s.d);
			area = stroke;
			const v = p.viewBox.trim().split(/[\s,]+/).map(Number);
			if (v.length === 4 && v.every(Number.isFinite) && v[2] > 0 && v[3] > 0) vb = v as ViewBox;
		} else {
			const b = BUILTIN[p.shape as ShapeId];
			stroke = b.stroke.map((d) => ({d: normalizePathD(d), rule: 'nonzero' as const}));
			area = b.area.map((d) => ({d: normalizePathD(d), rule: b.rule ?? ('nonzero' as const)}));
			vb = [0, 0, 100, 100];
		}
		if (!vb) vb = shapesBox(stroke);
		let pieces = shapesToPieces(stroke);
		if (p.order === 'size') pieces = [...pieces].sort((a, b) => b.len - a.len || a.index - b.index);
		// very detailed files: draw the 600 longest pieces, the rest fade in with the fill
		const rest = pieces.slice(600);
		pieces = pieces.slice(0, 600);
		return {vb, pieces, rest, area};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [p.svg, svgText, pathsKey, p.viewBox, p.shape, p.order]);

	// layout: fit the viewBox into size x maxHeight
	const vb = geo?.vb ?? ([0, 0, 100, 100] as ViewBox);
	const s = Math.min((p.size * W) / vb[2], (p.maxHeight * H) / vb[3]);
	const bw = vb[2] * s;
	const bh = vb[3] * s;
	const left = p.x * W - bw / 2;
	const top = p.y * H - bh / 2;

	const dotsPx = useMemo(() => {
		if (!geo || p.dots <= 0) return [];
		const margin = (p.dotSize * u * 0.55) / s;
		return samplePointsInside(geo.area, p.dots, margin, `ld${p.dotSeed}`).map((q) => ({x: left + (q.x - vb[0]) * s, y: top + (q.y - vb[1]) * s}));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [geo, p.dots, p.dotSize, p.dotSeed, u, s, left, top]);

	if (!geo) return null;
	const col = p.color || theme.fg;
	const fillCol = p.fillColor || col;
	const dotCol = p.dotColor || theme.accent;
	const sw = (p.strokeWidth * u) / s;
	const n = geo.pieces.length;
	const win = n > 1 ? Math.min(p.stagger * (n - 1), p.drawDuration * 0.45) : 0;
	const lmax = Math.max(1e-6, ...geo.pieces.map((q) => q.len));
	const drawEnd = p.start + p.drawDuration;
	const fillE = ease.outCubic(prog(t, drawEnd - 0.15, drawEnd + 0.35));
	const restE = ease.outCubic(prog(t, p.start + p.drawDuration * 0.5, drawEnd));
	const dotsAt = p.dotsAt >= 0 ? p.dotsAt : p.start + p.drawDuration * 0.85;

	return (
		<AbsoluteFill>
			<svg width={bw} height={bh} viewBox={vb.join(' ')} style={{position: 'absolute', left, top, overflow: 'visible'}}>
				{p.fillOpacity > 0 && fillE > 0
					? geo.area.map((a, i) => <path key={`f${i}`} d={a.d} fill={fillCol} fillRule={a.rule} opacity={p.fillOpacity * fillE} />)
					: null}
				{geo.pieces.map((q, r) => {
					const t0 = p.start + (n > 1 ? (win * r) / (n - 1) : 0);
					const dur = Math.max(0.12, (p.drawDuration - win) * Math.sqrt(q.len / lmax));
					const pr = drawEase(prog(t, t0, t0 + dur));
					if (pr <= 0.0005) return null;
					const D = q.len * 1.03 + sw;
					return (
						<path
							key={r}
							d={q.d}
							fill="none"
							stroke={col}
							strokeWidth={sw}
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeDasharray={pr >= 1 ? undefined : `${D} ${D}`}
							strokeDashoffset={pr >= 1 ? undefined : D * (1 - pr)}
						/>
					);
				})}
				{restE > 0
					? geo.rest.map((q, i) => <path key={`r${i}`} d={q.d} fill="none" stroke={col} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" opacity={restE} />)
					: null}
			</svg>
			{dotsPx.map((d, i) => {
				const t0 = dotsAt + i * p.dotStagger;
				if (t < t0) return null;
				const k = sp(frame, fps, t0, SPRINGS.pop);
				const op = clamp01(((t - t0) * fps) / 2);
				const h = p.dotSize * u * (0.9 + 0.2 * rnd(`lds${p.dotSeed}_${i}`));
				const anchor = p.dotStyle === 'pin' ? 'translate(-50%, -100%)' : 'translate(-50%, -50%)';
				let el: React.ReactNode;
				if (p.dotStyle === 'phone') el = <PhoneIcon h={h} color={dotCol} />;
				else if (p.dotStyle === 'pin') el = <PinIcon h={h} color={dotCol} />;
				else if (p.dotStyle === 'emoji') el = <div style={{fontFamily: EMOJI_STACK, fontSize: h * 0.92, lineHeight: 1}}>{p.dotEmoji}</div>;
				else el = <div style={{width: h * 0.55, height: h * 0.55, borderRadius: '50%', background: dotCol}} />;
				return (
					<div
						key={i}
						style={{
							position: 'absolute',
							left: d.x,
							top: d.y,
							transform: `${anchor} scale(${k})`,
							transformOrigin: p.dotStyle === 'pin' ? '50% 100%' : '50% 50%',
							opacity: op,
						}}
					>
						{el}
					</div>
				);
			})}
		</AbsoluteFill>
	);
};

export const lineDraw = defineLook({
	id: 'line-draw',
	category: 'diagram',
	kind: 'overlay',
	duration: 3,
	outro: 0.3,
	usesFont2: false,
	description: 'An outline draws itself on (pieces staggered, longest first), an optional flat fill fades in, then dots / tiny phone icons / pins / emojis pop in at evenly spread points inside the shape. Built-in outlines (house, heart, phone, document, globe, cloud, shield, star, pin, folder), raw path strings, or any .svg file (e.g. a country map).',
	props,
	render: LineDraw,
});
