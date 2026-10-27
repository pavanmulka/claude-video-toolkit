// stat-split: full-bleed split panels showing shares (48 % / 52 %). Panel A grows from its edge while its
// number counts up, panel B grows from the opposite edge to meet it; soft pastel gradients, dark ink text,
// fixed-width digits; exit splits the panels apart off their edges.
import React, {useMemo} from 'react';
import {AbsoluteFill, Img, useCurrentFrame} from 'remotion';
import {z} from 'zod';
import {ease, formatNumber, lerp, prog, resolveDecimals, type NumberFormat} from '../lib/anim';
import {EMOJI_STACK, fontCss} from '../lib/fonts';
import {assetSrc, defineLook, useLook, type LookProps} from '../lib/look';
import {measureText} from '../lib/measure';
import {parseRich, stripMarkup} from '../lib/rich';
import {color, doc, int, num, oneOf, str} from '../lib/schema';
import {Segs} from '../lib/text';
import {FORMATS} from './stat-counter';

const itemSchema = z.object({
	value: num(50, 'The share (e.g. 48 for 48 %)', -1e12, 1e12),
	label: str('', 'Label next to the number (**bold** markup)'),
	icon: str('', 'Optional icon before the label: a symbol or emoji ("♂", "♀", "📱") or an image (absolute path / motion/public path / URL)'),
	colors: doc(z.array(z.string()).default([]), 'Panel gradient [top, bottom] (one colour = flat); empty = built-in pastel pair'),
});

const props = {
	items: doc(
		z.array(itemSchema).default([
			{value: 48, label: 'Weekdays', icon: '', colors: []},
			{value: 52, label: 'Weekends', icon: '', colors: []},
		]),
		'Panels [{value, label, icon?, colors?}] (1-5). Item 0 sits at the bottom (vertical) / left (horizontal) and enters first',
	),
	direction: oneOf(['vertical', 'horizontal'] as const, 'vertical', 'vertical = panels stacked bottom to top | horizontal = side by side, left to right'),
	entry: oneOf(['grow', 'push'] as const, 'grow', 'grow = each panel grows from its own edge to its share | push = the first panel floods the box, each next one pushes in from the far edge'),
	total: num(0, 'Value of a full box; 0 = the sum of the values (panels fill the box)', 0, 1e12),
	format: oneOf(FORMATS, 'percent', 'Number format (see stat-counter)'),
	decimals: int(-1, 'Decimals; -1 = automatic from each value', -1, 6),
	prefix: str('', 'Text before each number'),
	suffix: str('', 'Text after each number'),
	start: num(0.05, 'Seconds before the first panel enters', 0, 30),
	countDuration: num(1.0, 'Seconds a panel takes to grow (its number counts over the same time)', 0.1, 30),
	stagger: num(0.5, 'Seconds between panels entering', 0, 10),
	size: num(150, 'Number size (design units; shrinks to fit)', 20, 600),
	labelSize: num(96, 'Label size (design units)', 10, 300),
	fg: color('#111111', 'Text colour (dark ink by default: the panels are light pastels)'),
	textPos: oneOf(['edge', 'center'] as const, 'edge', 'Text placement: edge = next to the shared boundary (rides it while growing) | center = middle of the panel'),
	pad: num(80, 'Distance of the text from the boundary (design units, textPos=edge)', 0, 600),
	gap: num(0, 'Gap between panels (design units)', 0, 200),
	radius: num(0, 'Corner radius of the box (design units)', 0, 400),
	blur: num(1, 'Motion blur on fast edges and text (0 = off)', 0, 3),
	exit: oneOf(['split', 'fade'] as const, 'split', 'Exit over `outro`: split = panels slide apart off their edges (reveals what is under) | fade'),
	x: num(0.5, 'Box centre (fraction of width)', 0, 1),
	y: num(0.5, 'Box centre (fraction of height)', 0, 1),
	panelWidth: num(1, 'Box width (fraction of the frame width)', 0.05, 1),
	panelHeight: num(1, 'Box height (fraction of the frame height)', 0.05, 1),
};

type P = LookProps<typeof props>;

const PALETTE: [string, string][] = [
	['#C9F5F3', '#3D8CF0'],
	['#EE8A5D', '#F9D6C8'],
	['#E3F7D2', '#5DBF6E'],
	['#E8DFFF', '#8B69EE'],
	['#FFF1C4', '#F2A73A'],
];

const isImage = (s: string) => /^(https?:|data:)|[/\\]|\.(png|jpe?g|webp|gif|svg)$/i.test(s.trim());

type Range = {a: number; b: number};

const StatSplit: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, Ds, outro, font, font2} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const items = p.items.slice(0, 5);
	const N = Math.max(1, items.length);
	const vertical = p.direction === 'vertical';
	const BW = p.panelWidth * W;
	const BH = p.panelHeight * H;
	const L = BW < W ? p.x * W - BW / 2 : 0;
	const T = BH < H ? p.y * H - BH / 2 : 0;
	const axis = vertical ? BH : BW;

	// final shares along the axis (from the bottom / left)
	const sum = items.reduce((s, it) => s + Math.max(0, it.value), 0);
	const tot = p.total > 0 ? p.total : Math.max(1e-9, sum);
	const shares = items.map((it) => Math.max(0, it.value) / tot);
	const starts: number[] = [];
	shares.reduce((c, s, i) => ((starts[i] = c), c + s), 0);
	const E = Math.min(1, starts[N - 1] + shares[N - 1]);
	const gapF = (p.gap * u) / axis;

	const layoutAt = (tt: number): {r: Range[]; g: number[]} => {
		const g = items.map((_, i) => {
			const t0 = p.start + i * p.stagger;
			return ease.outExpo(prog(tt, t0, t0 + p.countDuration));
		});
		let r: Range[];
		if (p.entry === 'push') {
			// panel 0 floods the box; panel k (k >= 1) pushes in from the far edge: its leading edge e[k]
			// travels from E to its final boundary and pushes whatever is below it
			const e = items.map((_, k) => (k === 0 ? 0 : lerp(E, starts[k], g[k])));
			r = items.map((_, i) => {
				const a = e[i];
				const cap = i < N - 1 ? e[i + 1] : E;
				const b = i === 0 ? Math.min(g[0] * E, cap) : cap;
				return {a, b: Math.max(a, b)};
			});
		} else {
			r = items.map((_, i) => {
				const a0 = starts[i];
				const b0 = starts[i] + shares[i];
				if (i === 0) return {a: a0, b: a0 + shares[i] * g[i]};
				if (i === N - 1) return {a: b0 - shares[i] * g[i], b: b0};
				const m = (a0 + b0) / 2;
				return {a: m - (shares[i] * g[i]) / 2, b: m + (shares[i] * g[i]) / 2};
			});
		}
		// gaps at the inner edges
		if (gapF > 0) r = r.map((q, i) => ({a: i > 0 ? q.a + gapF / 2 : q.a, b: i < N - 1 ? q.b - gapF / 2 : q.b})).map((q) => ({a: q.a, b: Math.max(q.a, q.b)}));
		// exit: split apart off the edges
		if (p.exit === 'split' && outro > 0) {
			const x = ease.inCubic(prog(tt, Ds - outro, Ds));
			if (x > 0) {
				r = r.map((q) => {
					const down = (q.a + q.b) / 2 <= E / 2 + 1e-6;
					const d = down ? -q.b * x : (1 - q.a) * x;
					return {a: q.a + d, b: q.b + d};
				});
			}
		}
		return {r, g};
	};

	const now = layoutAt(t);
	const prev = layoutAt(t - 1 / fps);

	// number formatting with fixed-width digits
	const numStyle: React.CSSProperties = {...fontCss(font), fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', lineHeight: 1, whiteSpace: 'nowrap'};
	const labelStyle: React.CSSProperties = {...fontCss(font), lineHeight: 1.1, whiteSpace: 'nowrap', letterSpacing: '-0.005em'};
	const fmtOf = (v: number) => ({format: p.format as NumberFormat, decimals: resolveDecimals(p.decimals, v, p.format as NumberFormat), prefix: p.prefix, suffix: p.suffix});
	const metrics = useMemo(() => {
		const base = p.size * u;
		const digitW = Math.max(...'0123456789'.split('').map((d) => measureText(d, {...numStyle, fontSize: base}).width));
		const widthOf = (s: string) => s.split('').reduce((w, ch) => w + (/\d/.test(ch) ? digitW : measureText(ch, {...numStyle, fontSize: base}).width), 0);
		const numW = Math.max(...items.map((it) => widthOf(formatNumber(it.value, fmtOf(it.value)))));
		const lfs = p.labelSize * u;
		const labelW = items.map((it) => {
			const txt = stripMarkup(it.label);
			const lw = txt ? measureText(txt, {...labelStyle, fontSize: lfs}).width : 0;
			const iw = it.icon ? lfs * 1.15 : 0;
			return lw + iw;
		});
		const gapW = 0.32 * base;
		const rowW = numW + (Math.max(...labelW) > 0 ? gapW + Math.max(...labelW) : 0);
		const colW = Math.max(numW, ...labelW);
		return {base, digitW, numW, labelW, gapW, rowW, colW};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [JSON.stringify(items), p.size, p.labelSize, u, font.family, font.weight, font.stretch, p.format, p.decimals, p.prefix, p.suffix]);
	// fit: vertical rows across the box; horizontal columns inside each final panel
	const fit = vertical
		? Math.min(1, (BW * 0.86) / Math.max(1, metrics.rowW))
		: Math.min(1, ...items.map((_, i) => (shares[i] * BW * 0.84) / Math.max(1, metrics.colW)));
	const rowLeft = (BW - metrics.rowW * fit) / 2;

	const Num: React.FC<{text: string}> = ({text}) => (
		<span style={{display: 'inline-flex'}}>
			{text.split('').map((ch, k) =>
				/\d/.test(ch) ? (
					<span key={k} style={{display: 'inline-block', width: metrics.digitW * fit, textAlign: 'center'}}>
						{ch}
					</span>
				) : (
					<span key={k}>{ch}</span>
				),
			)}
		</span>
	);

	const fadeOut = p.exit === 'fade' && outro > 0 ? 1 - ease.inCubic(prog(t, Ds - outro, Ds)) : 1;
	const shutter = 0.5 * p.blur;

	return (
		<AbsoluteFill style={{opacity: fadeOut}}>
			<svg width={0} height={0} style={{position: 'absolute'}}>
				<defs>
					{items.map((_, i) => {
						const v = Math.abs(((now.r[i].a + now.r[i].b) / 2 - (prev.r[i].a + prev.r[i].b) / 2) * axis);
						const dev = Math.min(28 * u, v * 0.18 * p.blur);
						return (
							<filter key={i} id={`ssblur${i}`} x="-20%" y="-60%" width="140%" height="220%">
								<feGaussianBlur stdDeviation={vertical ? `0 ${dev.toFixed(2)}` : `${dev.toFixed(2)} 0`} />
							</filter>
						);
					})}
				</defs>
			</svg>
			<div style={{position: 'absolute', left: L, top: T, width: BW, height: BH, overflow: 'hidden', borderRadius: p.radius * u}}>
				{items.map((it, i) => {
					const q = now.r[i];
					const q0 = prev.r[i];
					if (q.b - q.a <= 1e-5 && t < p.start + i * p.stagger + p.countDuration) return null;
					const cols = it.colors.length >= 2 ? [it.colors[0], it.colors[1]] : it.colors.length === 1 ? [it.colors[0], it.colors[0]] : PALETTE[i % PALETTE.length];
					// px along the axis, measured from the top (vertical) / left (horizontal)
					const near = vertical ? (1 - q.b) * BH : q.a * BW; // top / left edge
					const far = vertical ? (1 - q.a) * BH : q.b * BW; // bottom / right edge
					const near0 = vertical ? (1 - q0.b) * BH : q0.a * BW;
					const far0 = vertical ? (1 - q0.a) * BH : q0.b * BW;
					const sN = Math.abs(near - near0) * shutter;
					const sF = Math.abs(far - far0) * shutter;
					const len = far - near + (sN + sF) / 2;
					const mask =
						sN > 1 || sF > 1
							? `linear-gradient(${vertical ? 'to bottom' : 'to right'}, transparent 0px, #000 ${sN.toFixed(1)}px, #000 ${(len - sF).toFixed(1)}px, transparent ${len.toFixed(1)}px)`
							: undefined;
					const bgStyle: React.CSSProperties = vertical
						? {left: 0, width: BW, top: near - sN / 2, height: len}
						: {top: 0, height: BH, left: near - sN / 2, width: len};
					const t0 = p.start + i * p.stagger;
					const g = now.g[i];
					const value = it.value * g;
					const text = formatNumber(value, fmtOf(it.value));
					const textIn = ease.outCubic(prog(t, t0 + 0.02, t0 + 0.22));
					// text anchor inside the panel rect
					const pw = vertical ? BW : far - near;
					const ph = vertical ? far - near : BH;
					const fs = metrics.base * fit;
					const lfs = p.labelSize * u * fit;
					let cy = ph / 2;
					const rowH = fs;
					if (vertical && p.textPos === 'edge' && N > 1) {
						if (i === 0) cy = p.pad * u + rowH / 2;
						else if (i === N - 1) cy = ph - p.pad * u - rowH / 2;
					} else if (vertical && p.textPos === 'edge' && N === 1) cy = p.pad * u + rowH / 2;
					const rich = parseRich(it.label);
					const iconEl = it.icon ? (
						isImage(it.icon) ? (
							<Img src={assetSrc(it.icon)} style={{width: lfs * 0.95, height: lfs * 0.95, objectFit: 'contain', marginRight: lfs * 0.2, verticalAlign: '-0.12em'}} />
						) : (
							<span style={{fontFamily: `${labelStyle.fontFamily}, ${EMOJI_STACK}`, marginRight: lfs * 0.18}}>{it.icon}</span>
						)
					) : null;
					const label = it.label || it.icon ? (
						<span style={{...labelStyle, fontSize: lfs, color: p.fg}}>
							{iconEl}
							{rich.words.map((w, wi) => (
								<React.Fragment key={wi}>
									{wi > 0 ? ' ' : null}
									<Segs word={w} fg={p.fg} accent={p.fg} font2={font2} accentStyle={{fontWeight: 900}} />
								</React.Fragment>
							))}
						</span>
					) : null;
					const moving = Math.abs((near + far) / 2 - (near0 + far0) / 2) > 2;
					return (
						<React.Fragment key={i}>
							<div style={{position: 'absolute', ...bgStyle, background: `linear-gradient(to bottom, ${cols[0]}, ${cols[1]})`, WebkitMaskImage: mask, maskImage: mask}} />
							<div
								style={{
									position: 'absolute',
									overflow: 'hidden',
									...(vertical ? {left: 0, width: BW, top: near, height: Math.max(0, far - near)} : {top: 0, height: BH, left: near, width: Math.max(0, far - near)}),
								}}
							>
								{vertical ? (
									<div
										style={{
											position: 'absolute',
											left: rowLeft,
											top: cy,
											display: 'flex',
											alignItems: 'center',
											transform: `translateY(-50%) translateY(${(1 - textIn) * 18 * u}px)`,
											opacity: textIn,
											filter: moving && p.blur > 0 ? `url(#ssblur${i})` : undefined,
										}}
									>
										<div style={{...numStyle, fontSize: fs, color: p.fg, width: metrics.numW * fit, textAlign: 'right', display: 'flex', justifyContent: 'flex-end'}}>
											<Num text={text} />
										</div>
										{label ? <div style={{marginLeft: metrics.gapW * fit, display: 'flex', alignItems: 'center'}}>{label}</div> : null}
									</div>
								) : (
									<div
										style={{
											position: 'absolute',
											left: pw / 2,
											top: cy,
											display: 'flex',
											flexDirection: 'column',
											alignItems: 'center',
											transform: `translate(-50%, -50%) translateY(${(1 - textIn) * 18 * u}px)`,
											opacity: textIn,
											filter: moving && p.blur > 0 ? `url(#ssblur${i})` : undefined,
										}}
									>
										<div style={{...numStyle, fontSize: fs, color: p.fg}}>
											<Num text={text} />
										</div>
										{label ? <div style={{marginTop: 0.16 * fs}}>{label}</div> : null}
									</div>
								)}
							</div>
						</React.Fragment>
					);
				})}
			</div>
		</AbsoluteFill>
	);
};

export const statSplit = defineLook({
	id: 'stat-split',
	category: 'data',
	kind: 'overlay',
	duration: 3,
	outro: 0.35,
	customOutro: true,
	usesFont2: false,
	font: {weight: 500},
	description: 'Split panels showing shares (48 % / 52 %): panel A grows from its edge while its number counts up, panel B grows from the opposite edge to meet it (or pushes in); soft pastel gradients, dark ink numbers with fixed-width digits, labels with an icon/emoji; motion blur on fast edges; exit splits the panels apart off the frame.',
	props,
	render: StatSplit,
});
