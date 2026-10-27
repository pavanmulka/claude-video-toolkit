import {getLength} from '@remotion/paths';
import React, {useMemo} from 'react';
import {AbsoluteFill, Img, useCurrentFrame} from 'remotion';
import {z} from 'zod';
import {ease, prog, sp} from '../lib/anim';
import {luminance, mix, rgba} from '../lib/color';
import {EMOJI_STACK, fontCss} from '../lib/fonts';
import {assetSrc, defineLook, useLook, type LookProps} from '../lib/look';
import {doc, num, oneOf, str} from '../lib/schema';

const nodeSchema = z.object({
	label: str('Record', 'Node label'),
	icon: str('📄', 'Emoji (or leave empty)'),
	at: num(-1, 'Seconds at which the node is done: it lights up, a check pops and a pulse runs to it; -1 = never', -1, 3600),
	steps: doc(z.array(z.number()).default([]), 'Optional sub-steps (seconds): small dots on the node fill one by one; the node is done at the last one unless `at` is set'),
	color: str('', 'Accent for this node (hex), e.g. a red for an urgent node; empty = the theme accent'),
	wide: z.boolean().default(false).describe('layout tree: a full-width node under the grid (e.g. an urgent record)'),
	sub: z.boolean().default(false).describe('layout tree: a second-level node in a grid under the wide node, joined to it by a line (e.g. the sections of an urgent record)'),
});

const personSchema = z.object({
	name: str('Person', 'Name under the avatar'),
	photo: str('', 'Avatar image (absolute path / public path / URL); empty = initial on a gradient'),
	at: num(0, 'Seconds at which the person pops in', 0, 3600),
	nodesAt: num(-1, 'Seconds at which their nodes draw in (-1 = right after the person)', -1, 3600),
	nodes: doc(z.array(nodeSchema).default([]), 'Their records: [{label, icon, at, steps, color}] (up to 12; two staggered columns)'),
});

const miniSchema = z.object({
	name: str('', 'Name under the small avatar'),
	photo: str('', 'Avatar image'),
	at: num(0, 'Seconds at which it pops in', 0, 3600),
});

const focusSchema = z.object({
	at: num(0, 'Seconds at which the camera starts moving here', 0, 3600),
	row: num(-1, 'Person row to frame (0 = first); -1 = everyone', -1, 10),
});

const props = {
	people: doc(
		z.array(personSchema).default([
			{name: 'Ava', photo: '', at: 0.2, nodesAt: 0.6, nodes: [
				{label: 'Notes', icon: '📝', at: 1.4, steps: [], color: '', wide: false, sub: false},
				{label: 'Files', icon: '📁', at: 1.8, steps: [], color: '', wide: false, sub: false},
				{label: 'Tasks', icon: '✅', at: 2.2, steps: [], color: '', wide: false, sub: false},
				{label: 'Urgent', icon: '🚨', at: -1, steps: [2.4, 2.6, 2.8], color: '#FF5A5F', wide: false, sub: false},
			]},
			{name: 'Sam', photo: '', at: 3.2, nodesAt: 3.5, nodes: [
				{label: 'Notes', icon: '📝', at: -1, steps: [], color: '', wide: false, sub: false},
				{label: 'Files', icon: '📁', at: -1, steps: [], color: '', wide: false, sub: false},
			]},
		]),
		'People, top to bottom (1-3): [{name, photo, at, nodesAt, nodes:[{label, icon, at, steps, color}]}]',
	),
	minis: doc(z.array(miniSchema).default([]), 'More people as small avatars in a row under the last person: [{name, photo, at}]'),
	focus: doc(z.array(focusSchema).default([]), 'Camera: [{at, row}] (row -1 = everyone). Default: the first person until the second one appears, then everyone'),
	x: num(0.04, 'Region left (fraction of width)', 0, 1),
	y: num(0.36, 'Region top (fraction of height)', 0, 1),
	w: num(0.44, 'Region width (fraction of width)', 0.05, 1),
	h: num(0.58, 'Region height (fraction of height)', 0.05, 1),
	tone: oneOf(['auto', 'dark', 'light'] as const, 'auto', 'Node surface: light (white cards, dark text) for light stages, dark glass, or auto from the theme text colour'),
	speed: num(1, 'Pulse speed multiplier along done links', 0, 10),
	nodeSize: num(1, 'Scale of every node and avatar', 0.3, 3),
	layout: oneOf(['horizontal', 'tree'] as const, 'horizontal', 'horizontal: avatar left, two staggered node columns right, people stacked; tree: avatar on top, nodes in a grid below it (wide nodes under the grid), people side by side'),
	columns: num(3, 'layout tree: node grid columns', 1, 6),
	perRow: num(3, 'layout tree: people per row in the group view', 1, 8),
	compactCols: num(2, 'layout tree: card columns per person in the group view (text cards, no icons)', 1, 6),
	valign: oneOf(['center', 'top'] as const, 'center', 'layout tree: where the tree sits in its region'),
	compactAt: num(-1, 'layout tree: seconds at which the first person\'s tree shrinks to icon tiles and the camera frames everyone (the group view); -1 = never', -1, 3600),
};

type P = LookProps<typeof props>;

// design sizes (u = 1 at 1080 px short side)
const A = 120; // avatar
const PW = 262; // pill width
const PH = 52; // pill height
const GY = 16; // vertical gap between pills of one column
const GX = 96; // avatar -> first column
const GC = 40; // column 1 -> column 2
const RG = 70; // gap between people rows
const MINI = 64;

// tree layout (content units): full = the first person alone, compact = everyone (smaller text cards, `compactCols`)
const TA = 120; // avatar
const TNAME = 46; // name line under the avatar
const TPX = 46; // gap between people (compact)
const TPY = 56;
type Mode = {pw: number; ph: number; gx: number; gy: number; top: number; font: number; subPh: number; subFont: number; trunk: number; cols: number; icon: boolean};
const FULL = {pw: 262, ph: 52, gx: 22, gy: 16, top: 58, font: 22, subPh: 46, subFont: 19, trunk: 30, icon: true};
const COMPACT = {pw: 184, ph: 38, gx: 10, gy: 8, top: 34, font: 16.5, subPh: 34, subFont: 15, trunk: 20, icon: false};

type Rect = {x: number; y: number; w: number; h: number};
type Tree = {ax: number; ay: number; nameY: number; nodes: Rect[]; kind: ('grid' | 'wide' | 'sub')[]; box: Rect};

/** One person's tree at (bx, by): avatar on top, the node grid, wide nodes under it, then the `sub` nodes in a grid
 *  under the wide node (joined to it by one line). */
const treeAt = (nodes: {wide: boolean; sub: boolean}[], M: Mode, bx: number, by: number): Tree => {
	const idx = (f: (n: {wide: boolean; sub: boolean}) => boolean) => nodes.map((n, i) => (f(n) ? i : -1)).filter((i) => i >= 0);
	const grid = idx((n) => !n.wide && !n.sub);
	const wides = idx((n) => n.wide && !n.sub);
	const subs = idx((n) => n.sub);
	const c = Math.max(1, Math.min(M.cols, Math.max(grid.length, subs.length, 1)));
	const gridW = c * M.pw + (c - 1) * M.gx;
	const w = Math.max(TA, gridW);
	const x0 = bx + (w - gridW) / 2;
	const out: Rect[] = new Array(nodes.length);
	const kind: Tree['kind'] = new Array(nodes.length);
	const place = (ids: number[], top: number, h: number) => {
		const rows = Math.ceil(ids.length / c);
		ids.forEach((ni, j) => {
			const r = Math.floor(j / c);
			const inRow = r === rows - 1 ? ids.length - r * c : c;
			const rowW = inRow * M.pw + (inRow - 1) * M.gx;
			out[ni] = {x: bx + (w - rowW) / 2 + (j % c) * (M.pw + M.gx), y: top + r * (h + M.gy), w: M.pw, h};
		});
		return top + rows * (h + M.gy);
	};
	let y = place(grid, by + TA + TNAME + M.top, M.ph);
	grid.forEach((i) => (kind[i] = 'grid'));
	wides.forEach((i) => {
		out[i] = {x: x0, y, w: gridW, h: M.ph};
		kind[i] = 'wide';
		y += M.ph + M.gy;
	});
	if (subs.length) {
		y = place(subs, y - M.gy + M.trunk, M.subPh);
		subs.forEach((i) => (kind[i] = 'sub'));
	}
	return {ax: bx + w / 2, ay: by + TA / 2, nameY: by + TA + 8, nodes: out, kind, box: {x: bx, y: by, w, h: y - M.gy - by}};
};

const lerp = (a: number, b: number, m: number) => a + (b - a) * m;
const lerpRect = (a: Rect, b: Rect, m: number): Rect => ({x: lerp(a.x, b.x, m), y: lerp(a.y, b.y, m), w: lerp(a.w, b.w, m), h: lerp(a.h, b.h, m)});

const TreeMap: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const k = u * p.nodeSize;
	const light = p.tone === 'light' || (p.tone === 'auto' && luminance(theme.fg) < 0.35);
	const ink = light ? '#16121F' : theme.fg;
	const muted = light ? '#8C879B' : rgba(theme.fg, 0.55);
	const lineBase = light ? mix(theme.accent, '#16121F', 0.35) : theme.accent;
	const done = '#22B573';
	const MF: Mode = {...FULL, cols: Math.round(p.columns)};
	const MC: Mode = {...COMPACT, cols: Math.round(p.compactCols)};
	const per = Math.max(1, Math.round(p.perRow));

	// content layouts: the first person alone (full) and everyone (compact), each framed by its own camera
	const L = useMemo(() => {
		const full = treeAt(p.people[0]?.nodes ?? [], MF, 0, 0);
		const trees: Tree[] = [];
		const n = p.people.length;
		const blockW = Math.max(...p.people.map((q) => treeAt(q.nodes, MC, 0, 0).box.w));
		const cols = Math.min(n, per);
		const allW = cols * blockW + (cols - 1) * TPX;
		let y = 0;
		for (let r = 0; r < Math.ceil(n / per); r++) {
			const ids = p.people.map((_, i) => i).slice(r * per, r * per + per);
			const rowW = ids.length * blockW + (ids.length - 1) * TPX;
			let rowH = 0;
			ids.forEach((i, j) => {
				const own = treeAt(p.people[i].nodes, MC, 0, 0).box.w;
				trees[i] = treeAt(p.people[i].nodes, MC, (allW - rowW) / 2 + j * (blockW + TPX) + (blockW - own) / 2, y);
				rowH = Math.max(rowH, trees[i].box.h);
			});
			y += rowH + TPY;
		}
		return {full, trees, all: {x: 0, y: 0, w: allW, h: y - TPY}};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [p.people, p.columns, p.compactCols, per]);

	const box = {x: p.x * W, y: p.y * H, w: p.w * W, h: p.h * H};
	const camFor = (r: Rect, cap: number) => {
		const s = Math.min(box.w / (r.w * k), box.h / (r.h * k), cap);
		const ty = p.valign === 'top' ? box.y - r.y * k * s : box.y + (box.h - r.h * k * s) / 2 - r.y * k * s;
		return {s: s * k, tx: box.x + (box.w - r.w * k * s) / 2 - r.x * k * s, ty};
	};
	const camA = camFor(L.full.box, 1.35);
	const camB = camFor(L.all, 1.35);
	const m = p.compactAt >= 0 ? ease.inOutCubic(prog(t, p.compactAt, p.compactAt + 0.9)) : 0;
	type Cam = {s: number; tx: number; ty: number};
	const scr = (c: Cam, r: Rect): Rect => ({x: c.tx + r.x * c.s, y: c.ty + r.y * c.s, w: r.w * c.s, h: r.h * c.s});
	const scrPt = (c: Cam, x: number, y: number) => ({x: c.tx + x * c.s, y: c.ty + y * c.s});
	type G = {av: {x: number; y: number}; nameY: number; nodes: Rect[]; s: number; font: number; subFont: number; name: number; cm: number};
	const geoOf = (c: Cam, tr: Tree, M: Mode, cm: number): G => ({
		av: scrPt(c, tr.ax, tr.ay), nameY: scrPt(c, tr.ax, tr.nameY).y, nodes: tr.nodes.map((r) => scr(c, r)), s: c.s,
		font: M.font * c.s, subFont: M.subFont * c.s, name: (cm ? 27 : 30) * c.s, cm});
	const geo: G[] = p.people.map((_, i) => {
		const B = geoOf(camB, L.trees[i], MC, 1);
		if (i > 0 || m >= 1) return B;
		const A = geoOf(camA, L.full, MF, 0);
		if (m <= 0) return A;
		return {av: {x: lerp(A.av.x, B.av.x, m), y: lerp(A.av.y, B.av.y, m)}, nameY: lerp(A.nameY, B.nameY, m),
			nodes: A.nodes.map((r, j) => lerpRect(r, B.nodes[j], m)), s: lerp(A.s, B.s, m), font: lerp(A.font, B.font, m),
			subFont: lerp(A.subFont, B.subFont, m), name: lerp(A.name, B.name, m), cm: m};
	});
	const kindOf = (i: number) => (i === 0 ? L.full.kind : L.trees[i].kind);
	const doneAt = (nd: P['people'][number]['nodes'][number]) => (nd.at >= 0 ? nd.at : nd.steps.length ? Math.max(...nd.steps) : -1);

	return (
		<AbsoluteFill>
			<svg width={W} height={H} style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
				{p.people.map((person, i) => {
					if (t < person.at) return null;
					const g = geo[i];
					const S = g.s;
					const ns = person.nodes.slice(0, 24);
					const kinds = kindOf(i);
					const grid = ns.map((_, ni) => ni).filter((ni) => kinds[ni] === 'grid');
					const wides = ns.map((_, ni) => ni).filter((ni) => kinds[ni] === 'wide');
					const subs = ns.map((_, ni) => ni).filter((ni) => kinds[ni] === 'sub');
					const cols = Math.max(1, Math.round(lerp(MF.cols, MC.cols, g.cm > 0.5 ? 1 : 0)));
					const c = Math.max(1, Math.min(cols, Math.max(grid.length, subs.length, 1)));
					const bottom = (r: Rect) => ({x: r.x + r.w / 2, y: r.y + r.h});
					return ns.map((nd, ni) => {
						const r = g.nodes[ni];
						const start = (person.nodesAt >= 0 ? person.nodesAt : person.at + 0.35) + ni * 0.04;
						const draw = ease.inOutCubic(prog(t, start, start + 0.55));
						if (draw <= 0) return null;
						// a tree: the first row hangs from the avatar, every other card from the card above it, the wide
						// card from the middle of the last row, the sub cards from the wide card
						let src = {x: g.av.x, y: g.nameY + 40 * S};
						const gi = grid.indexOf(ni);
						const si = subs.indexOf(ni);
						if (gi >= c) src = bottom(g.nodes[grid[gi - c]]);
						else if (kinds[ni] === 'wide' && grid.length) {
							const last = grid.slice(-(((grid.length - 1) % c) + 1));
							src = bottom(g.nodes[last[Math.floor((last.length - 1) / 2)]]);
						} else if (si >= c) src = bottom(g.nodes[subs[si - c]]);
						else if (si >= 0 && wides.length) src = bottom(g.nodes[wides[wides.length - 1]]);
						const ex = r.x + r.w / 2;
						const ey = r.y;
						const my = src.y + (ey - src.y) * 0.5;
						const d = `M ${src.x} ${src.y} C ${src.x} ${my}, ${ex} ${my}, ${ex} ${ey}`;
						const Ln = Math.max(1, getLength(d));
						const da = doneAt(nd);
						const isDone = da >= 0 && t >= da;
						const col = nd.color || lineBase;
						const run = da >= 0 ? prog(t, da - 0.35, da + 0.15) : 0;
						const pl = 60 * S;
						return (
							<g key={`${i}-${ni}`}>
								<path d={d} fill="none" stroke={isDone ? rgba(col, 0.55) : rgba(nd.color || lineBase, 0.22)} strokeWidth={(isDone ? 3 : 2.2) * S} strokeLinecap="round" strokeDasharray={Ln} strokeDashoffset={Ln * (1 - draw)} />
								{run > 0 && run < 1 ? (
									<path d={d} fill="none" stroke={mix(col, '#FFFFFF', 0.3)} strokeWidth={5 * S} strokeLinecap="round" strokeDasharray={`${pl} ${Ln + pl}`} strokeDashoffset={Ln * (1 - run) + pl * run} />
								) : null}
							</g>
						);
					});
				})}
			</svg>
			{p.people.map((person, i) => {
				if (t < person.at) return null;
				const g = geo[i];
				const S = g.s;
				const e = sp(frame, fps, person.at, {damping: 13, stiffness: 190});
				const size = TA * S;
				const url = assetSrc(person.photo);
				return (
					<div key={`av${i}`} style={{position: 'absolute', left: g.av.x - size / 2, top: g.av.y - size / 2, width: size, display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `scale(${0.4 + 0.6 * e})`, opacity: Math.min(1, e * 1.6)}}>
						<div style={{width: size, height: size, borderRadius: '50%', padding: 5 * S, boxSizing: 'border-box', background: `conic-gradient(from ${t * 40}deg, ${theme.accent}, ${theme.accent2}, ${theme.accent})`, boxShadow: `0 ${10 * S}px ${26 * S}px rgba(20,16,40,${light ? 0.18 : 0.45})`}}>
							<div style={{width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden', background: `linear-gradient(135deg, ${theme.accent2}, ${theme.accent})`, border: `${3 * S}px solid ${light ? '#FFFFFF' : theme.bg}`, boxSizing: 'border-box'}}>
								{url ? <Img src={url} style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : null}
							</div>
						</div>
						<div style={{...fontCss(font, {weight: 800}), fontSize: g.name, color: ink, marginTop: 8 * S, whiteSpace: 'nowrap'}}>{person.name}</div>
					</div>
				);
			})}
			{p.people.map((person, i) => {
				if (t < person.at) return null;
				const g = geo[i];
				const S = g.s;
				const kinds = kindOf(i);
				return person.nodes.slice(0, 24).map((nd, ni) => {
					const r = g.nodes[ni];
					const start = (person.nodesAt >= 0 ? person.nodesAt : person.at + 0.35) + ni * 0.04 + 0.25;
					const e = sp(frame, fps, start, {damping: 15, stiffness: 190});
					if (t < start) return null;
					const da = doneAt(nd);
					const isDone = da >= 0 && t >= da;
					const flash = isDone ? Math.exp(-(t - da) / 0.5) : 0;
					const col = nd.color || theme.accent;
					const check = isDone ? sp(frame, fps, da, {damping: 11, stiffness: 220}) : 0;
					const isSub = kinds[ni] === 'sub';
					const fs = isSub ? g.subFont : g.font;
					const iconA = 1 - Math.min(1, g.cm * 1.8);
					const iconBox = (isSub ? 30 : 36) * S;
					const pad = Math.max(4, r.h * 0.22);
					const stepsDone = nd.steps.filter((s0) => t >= s0).length;
					return (
						<div key={`n${i}-${ni}`} style={{
							position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, boxSizing: 'border-box',
							borderRadius: Math.min(16 * S, r.h * 0.34), display: 'flex', alignItems: 'center', gap: 8 * S * iconA, padding: `0 ${pad}px 0 ${pad * (0.6 + 0.4 * (1 - iconA))}px`,
							background: light ? (isDone ? '#FFFFFF' : '#F3F2F7') : isDone ? rgba(mix(theme.bg, '#FFFFFF', 0.2), 0.95) : rgba(mix(theme.bg, '#FFFFFF', 0.08), 0.8),
							border: `${Math.max(1.2, 2 * S)}px solid ${isDone ? rgba(col, 0.55 + 0.45 * flash) : nd.color ? rgba(nd.color, 0.28) : light ? '#E3E1EA' : rgba('#FFFFFF', 0.12)}`,
							boxShadow: isDone ? `0 ${6 * S}px ${16 * S}px rgba(20,16,40,${light ? 0.1 : 0.4}), 0 0 ${24 * S}px ${rgba(col, 0.55 * flash)}` : 'none',
							opacity: Math.min(1, e * 1.5), transform: `translateY(${(1 - e) * -16 * S}px) scale(${(0.85 + 0.15 * e) * (1 + 0.05 * flash)})`,
						}}>
							{iconA > 0.02 && nd.icon && !isSub ? (
								<div style={{width: iconBox * iconA, height: iconBox, borderRadius: 10 * S, flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: iconA, background: isDone ? rgba(col, 0.16) : light ? '#E9E7F0' : rgba('#FFFFFF', 0.08), fontFamily: EMOJI_STACK, fontSize: (isSub ? 17 : 20) * S, filter: isDone ? 'none' : 'grayscale(1) opacity(0.6)'}}>
									{nd.icon}
								</div>
							) : null}
							<div style={{...fontCss(font, {weight: 700}), fontSize: fs, color: isDone ? ink : muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1}}>{nd.label}</div>
							{nd.steps.length && !isDone ? (
								<div style={{display: 'grid', gridTemplateColumns: `repeat(${Math.ceil(nd.steps.length / 2)}, ${6 * S}px)`, gap: 3 * S, flexShrink: 0}}>
									{nd.steps.map((s0, si) => (
										<div key={si} style={{width: 6 * S, height: 6 * S, borderRadius: '50%', background: si < stepsDone ? col : light ? '#D6D3DF' : rgba('#FFFFFF', 0.2)}} />
									))}
								</div>
							) : null}
							{isDone ? (
								<div style={{width: g.cm > 0.5 ? 17 * S : r.h * 0.5, height: g.cm > 0.5 ? 17 * S : r.h * 0.5, borderRadius: '50%', background: done, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${check})`,
									...(g.cm > 0.5 ? {position: 'absolute', right: -6 * S, top: -6 * S, boxShadow: `0 0 0 ${2 * S}px ${light ? '#FFFFFF' : theme.bg}`} : {})}}>
									<svg width={(g.cm > 0.5 ? 17 * S : r.h * 0.5) * 0.6} height={(g.cm > 0.5 ? 17 * S : r.h * 0.5) * 0.6} viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="#FFFFFF" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" /></svg>
								</div>
							) : null}
						</div>
					);
				});
			})}
		</AbsoluteFill>
	);
};

const NodeMap: React.FC<{p: P}> = ({p}) => {
	if (p.layout === 'tree') return <TreeMap p={p} />;
	return <HorizontalMap p={p} />;
};

const HorizontalMap: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const k = u * p.nodeSize;
	const light = p.tone === 'light' || (p.tone === 'auto' && luminance(theme.fg) < 0.35);
	const ink = light ? '#16121F' : theme.fg;
	const muted = light ? '#8C879B' : rgba(theme.fg, 0.55);
	const lineBase = light ? mix(theme.accent, '#16121F', 0.35) : theme.accent;
	const done = '#22B573';

	// ---- layout in content space (origin = top-left of the first avatar column)
	const layout = useMemo(() => {
		const rows: {top: number; h: number; ax: number; ay: number; nodes: {x: number; y: number}[]}[] = [];
		let y = 0;
		for (const person of p.people) {
			const n = Math.min(12, person.nodes.length);
			const n1 = Math.ceil(n / 2);
			const step = PH + GY;
			const colH = Math.max(1, n1) * step - GY + (n > 1 ? step / 2 : 0);
			const h = Math.max(A + 50, colH);
			const nodes = person.nodes.slice(0, 12).map((_, i) => {
				const col = i < n1 ? 0 : 1;
				const r = col === 0 ? i : i - n1;
				return {x: A + GX + col * (PW + GC), y: y + (h - colH) / 2 + r * step + (col ? step / 2 : 0) + PH / 2};
			});
			rows.push({top: y, h, ax: A / 2, ay: y + h / 2, nodes});
			y += h + RG;
		}
		const minisTop = y;
		const contentH = y - RG + (p.minis.length ? RG * 0.6 + MINI + 40 : 0);
		const contentW = A + GX + 2 * PW + GC;
		return {rows, minisTop, contentW, contentH};
	}, [p.people, p.minis.length]);

	// ---- camera
	const box = {x: p.x * W, y: p.y * H, w: p.w * W, h: p.h * H};
	const frameFor = (row: number) => {
		const r = row >= 0 && layout.rows[row] ? layout.rows[row] : null;
		const top = r ? r.top : 0;
		const hh = r ? r.h : layout.contentH;
		const s = Math.min(box.w / (layout.contentW * k), box.h / (hh * k), r ? 1.35 : 10);
		return {s, tx: box.x + (box.w - layout.contentW * k * s) / 2, ty: box.y + (box.h - hh * k * s) / 2 - top * k * s};
	};
	const focus = p.focus.length
		? p.focus
		: [{at: 0, row: 0}, ...(p.people.length > 1 ? [{at: p.people[1].at, row: -1}] : [])];
	let cam = frameFor(focus[0].row);
	for (let i = 1; i < focus.length; i++) {
		const e = ease.inOutCubic(prog(t, focus[i].at, focus[i].at + 0.9));
		if (e <= 0) break;
		const nx = frameFor(focus[i].row);
		cam = {s: cam.s + (nx.s - cam.s) * e, tx: cam.tx + (nx.tx - cam.tx) * e, ty: cam.ty + (nx.ty - cam.ty) * e};
	}
	const S = k * cam.s;
	const X = (cx: number) => cam.tx + cx * S;
	const Y = (cy: number) => cam.ty + cy * S;

	// ---- links (screen space)
	const links = layout.rows.map((r, ri) =>
		r.nodes.map((n) => {
			const sx = X(r.ax + A / 2 + 6);
			const sy = Y(r.ay);
			const ex = X(n.x);
			const ey = Y(n.y);
			const dx = ex - sx;
			const d = `M ${sx} ${sy} C ${sx + dx * 0.45} ${sy}, ${ex - dx * 0.55} ${ey}, ${ex} ${ey}`;
			return {d, L: Math.max(1, getLength(d)), ri};
		}),
	);

	const doneAt = (nd: P['people'][number]['nodes'][number]) => (nd.at >= 0 ? nd.at : nd.steps.length ? Math.max(...nd.steps) : -1);
	const period = 1.8 / Math.max(0.05, p.speed);

	return (
		<AbsoluteFill>
			<svg width={W} height={H} style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
				<defs>
					<filter id="nmglow" x="-20%" y="-50%" width="140%" height="200%">
						<feGaussianBlur stdDeviation={5 * S} />
					</filter>
				</defs>
				{/* trunk between avatars */}
				{layout.rows.slice(1).map((r, i) => {
					const a = layout.rows[i];
					const appear = p.people[i + 1].at;
					const draw = ease.inOutCubic(prog(t, appear - 0.3, appear + 0.4));
					if (draw <= 0) return null;
					const y0 = Y(a.ay + A / 2 + 34);
					const y1 = Y(r.ay - A / 2 - 6);
					return <line key={`tr${i}`} x1={X(a.ax)} x2={X(a.ax)} y1={y0} y2={y0 + (y1 - y0) * draw} stroke={rgba(lineBase, 0.35)} strokeWidth={3 * S} strokeDasharray={`${8 * S} ${8 * S}`} strokeLinecap="round" />;
				})}
				{links.map((row, ri) =>
					row.map((lk, ni) => {
						const person = p.people[ri];
						const nd = person.nodes[ni];
						const start = (person.nodesAt >= 0 ? person.nodesAt : person.at + 0.35) + ni * 0.06;
						const draw = ease.inOutCubic(prog(t, start, start + 0.55));
						if (draw <= 0) return null;
						const da = doneAt(nd);
						const isDone = da >= 0 && t >= da;
						const col = nd.color || lineBase;
						// one bright run to the node when it is done, then calm loops
						const run = da >= 0 ? prog(t, da - 0.35, da + 0.15) : 0;
						const loopPh = isDone ? ((t - da) / period + ni * 0.23) % 1 : -1;
						const pulseLen = 70 * S;
						const pulse = (ph: number, key: string, strong: number) => (
							<g key={key}>
								<path d={lk.d} fill="none" stroke={col} strokeWidth={12 * S} strokeLinecap="round" strokeDasharray={`${pulseLen} ${lk.L + pulseLen}`} strokeDashoffset={lk.L * (1 - ph) + pulseLen * ph} opacity={0.45 * strong} filter="url(#nmglow)" />
								<path d={lk.d} fill="none" stroke={mix(col, '#FFFFFF', 0.35)} strokeWidth={4 * S} strokeLinecap="round" strokeDasharray={`${pulseLen} ${lk.L + pulseLen}`} strokeDashoffset={lk.L * (1 - ph) + pulseLen * ph} opacity={strong} />
							</g>
						);
						return (
							<g key={`${ri}-${ni}`}>
								<path d={lk.d} fill="none" stroke={isDone ? rgba(col, 0.6) : rgba(lineBase, 0.22)} strokeWidth={(isDone ? 3.2 : 2.4) * S} strokeLinecap="round" strokeDasharray={lk.L} strokeDashoffset={lk.L * (1 - draw)} />
								{run > 0 && run < 1 ? pulse(run, 'run', 1) : null}
								{loopPh >= 0 && t > da + 0.2 ? pulse(loopPh, 'loop', 0.55) : null}
							</g>
						);
					}),
				)}
			</svg>
			{/* avatars */}
			{layout.rows.map((r, ri) => {
				const person = p.people[ri];
				const e = sp(frame, fps, person.at, {damping: 13, stiffness: 190});
				if (t < person.at) return null;
				const size = A * S;
				const url = assetSrc(person.photo);
				const allDone = person.nodes.length > 0 && person.nodes.every((nd) => doneAt(nd) >= 0 && t >= doneAt(nd));
				return (
					<div key={`av${ri}`} style={{position: 'absolute', left: X(r.ax) - size / 2, top: Y(r.ay) - size / 2, width: size, display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `scale(${0.4 + 0.6 * e})`, opacity: Math.min(1, e * 1.6)}}>
						<div style={{width: size, height: size, borderRadius: '50%', padding: 5 * S, boxSizing: 'border-box', background: `conic-gradient(from ${t * 40}deg, ${theme.accent}, ${theme.accent2}, ${theme.accent})`, boxShadow: `0 ${10 * S}px ${26 * S}px rgba(20,16,40,${light ? 0.18 : 0.45})${allDone ? `, 0 0 ${30 * S}px ${rgba(done, 0.5)}` : ''}`}}>
							<div style={{width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden', background: `linear-gradient(135deg, ${theme.accent2}, ${theme.accent})`, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `${3 * S}px solid ${light ? '#FFFFFF' : theme.bg}`, boxSizing: 'border-box'}}>
								{url ? <Img src={url} style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : <span style={{...fontCss(font, {weight: 900}), fontSize: size * 0.42, color: '#FFFFFF'}}>{(person.name[0] ?? '•').toUpperCase()}</span>}
							</div>
						</div>
						<div style={{...fontCss(font, {weight: 800}), fontSize: 30 * S, color: ink, marginTop: 8 * S, whiteSpace: 'nowrap'}}>{person.name}</div>
					</div>
				);
			})}
			{/* nodes */}
			{layout.rows.map((r, ri) =>
				r.nodes.map((n, ni) => {
					const person = p.people[ri];
					const nd = person.nodes[ni];
					const start = (person.nodesAt >= 0 ? person.nodesAt : person.at + 0.35) + ni * 0.06 + 0.25;
					const e = sp(frame, fps, start, {damping: 15, stiffness: 190});
					if (t < start) return null;
					const da = doneAt(nd);
					const isDone = da >= 0 && t >= da;
					const flash = isDone ? Math.exp(-(t - da) / 0.5) : 0;
					const col = nd.color || theme.accent;
					const check = isDone ? sp(frame, fps, da, {damping: 11, stiffness: 220}) : 0;
					const stepsDone = nd.steps.filter((s) => t >= s).length;
					const fs = 22 * S;
					return (
						<div key={`n${ri}-${ni}`} style={{
							position: 'absolute', left: X(n.x), top: Y(n.y) - (PH * S) / 2, width: PW * S, height: PH * S, boxSizing: 'border-box',
							borderRadius: 16 * S, display: 'flex', alignItems: 'center', gap: 9 * S, padding: `0 ${10 * S}px 0 ${8 * S}px`,
							background: light ? (isDone ? '#FFFFFF' : '#F3F2F7') : isDone ? rgba(mix(theme.bg, '#FFFFFF', 0.2), 0.95) : rgba(mix(theme.bg, '#FFFFFF', 0.08), 0.8),
							border: `${2 * S}px solid ${isDone ? rgba(col, 0.55 + 0.45 * flash) : light ? '#E3E1EA' : rgba('#FFFFFF', 0.12)}`,
							boxShadow: isDone ? `0 ${8 * S}px ${20 * S}px rgba(20,16,40,${light ? 0.12 : 0.4}), 0 0 ${26 * S}px ${rgba(col, 0.55 * flash)}` : 'none',
							opacity: Math.min(1, e * 1.5), transform: `translateX(${(1 - e) * -24 * S}px) scale(${(0.85 + 0.15 * e) * (1 + 0.06 * flash)})`,
						}}>
							<div style={{width: 36 * S, height: 36 * S, borderRadius: 11 * S, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isDone ? rgba(col, 0.16) : light ? '#E9E7F0' : rgba('#FFFFFF', 0.08), fontFamily: EMOJI_STACK, fontSize: 20 * S, filter: isDone ? 'none' : 'grayscale(1) opacity(0.6)'}}>
								{nd.icon}
							</div>
							<div style={{...fontCss(font, {weight: 700}), fontSize: fs, color: isDone ? ink : muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1}}>{nd.label}</div>
							{nd.steps.length && !isDone ? (
								<div style={{display: 'grid', gridTemplateColumns: `repeat(${Math.ceil(nd.steps.length / 2)}, ${7 * S}px)`, gap: 3 * S, flexShrink: 0}}>
									{nd.steps.map((s, si) => (
										<div key={si} style={{width: 7 * S, height: 7 * S, borderRadius: '50%', background: si < stepsDone ? col : light ? '#D6D3DF' : rgba('#FFFFFF', 0.2)}} />
									))}
								</div>
							) : null}
							{isDone ? (
								<div style={{width: 26 * S, height: 26 * S, borderRadius: '50%', background: done, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${check})`}}>
									<svg width={15 * S} height={15 * S} viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="#FFFFFF" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" /></svg>
								</div>
							) : null}
						</div>
					);
				}),
			)}
			{/* more people */}
			{p.minis.map((m, mi) => {
				if (t < m.at) return null;
				const e = sp(frame, fps, m.at, {damping: 13, stiffness: 190});
				const size = MINI * S;
				const url = assetSrc(m.photo);
				const cx = X(A / 2 + mi * (MINI + 46));
				const cy = Y(layout.minisTop + RG * 0.2 + MINI / 2);
				return (
					<div key={`m${mi}`} style={{position: 'absolute', left: cx - size / 2, top: cy - size / 2, width: size, display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `scale(${0.4 + 0.6 * e})`, opacity: Math.min(1, e * 1.6)}}>
						<div style={{width: size, height: size, borderRadius: '50%', overflow: 'hidden', border: `${3 * S}px solid ${light ? '#FFFFFF' : theme.bg}`, boxShadow: `0 ${6 * S}px ${16 * S}px rgba(20,16,40,0.2)`, background: `linear-gradient(135deg, ${theme.accent2}, ${theme.accent})`}}>
							{url ? <Img src={url} style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : null}
						</div>
						<div style={{...fontCss(font, {weight: 700}), fontSize: 20 * S, color: ink, marginTop: 5 * S, whiteSpace: 'nowrap'}}>{m.name}</div>
					</div>
				);
			})}
		</AbsoluteFill>
	);
};

export const nodeMap = defineLook({
	id: 'node-map',
	category: 'diagram',
	kind: 'overlay',
	duration: 5,
	description:
		"A node-graph map of people and their records (n8n-workflow style): each person is an avatar with a branch of record nodes in two staggered columns joined by curved links (or `layout: tree`: the avatar on top, the nodes in a grid below it, wide nodes such as an urgent record under the grid, and at `compactAt` the tree shrinks to smaller text cards while everyone else pops in beside it: the whole group fits; `sub` nodes hang under the wide node); nodes draw in dim, then light up with a check, a glow and a pulse running down their link at their `at` time (or fill step dots one by one), done links keep a calm flowing pulse; more people pop in below (dashed trunk) and as small avatars, and the camera eases from one person to everyone. Sits in a region of the frame (x, y, w, h), e.g. beside a phone.",
	usesFont2: false,
	weights: [700, 800, 900],
	props,
	render: NodeMap,
});
