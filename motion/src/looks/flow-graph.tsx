import {getLength} from '@remotion/paths';
import React, {useMemo} from 'react';
import {AbsoluteFill, Img, useCurrentFrame} from 'remotion';
import {z} from 'zod';
import {ease, prog, rnd, sp} from '../lib/anim';
import {luminance, mix, onColor, rgba} from '../lib/color';
import {EMOJI_STACK, fontCss, sansStack} from '../lib/fonts';
import {assetSrc, defineLook, useLook, type LookProps} from '../lib/look';
import {doc, num, oneOf, str} from '../lib/schema';

const side = z.enum(['left', 'right', 'top', 'bottom']);

const mediaSchema = z.object({
	type: z.enum(['none', 'waveform', 'code', 'timeline', 'lanes', 'images', 'motion']).default('none'),
	h: num(0, 'Height (canvas units); 0 = a default per type', 0, 5000),
	dur: num(1.2, 'Seconds the media animates for after the node lights', 0.05, 60),
	lines: doc(z.array(z.string()).default([]), 'code: lines (mono; `key:` parts in the accent), typed in one by one'),
	images: doc(z.array(z.string()).default([]), 'images: picture paths, slid in one by one as a strip'),
	count: num(5, 'lanes: number of parallel lanes; waveform: bars / 10', 1, 64),
	label: str('', 'timeline: counter label, e.g. "frame"; lanes: lane label prefix, e.g. "chunk"'),
	to: num(0, 'timeline: the counter counts up to this (e.g. the real frame count)', 0, 1e9),
});

const nodeSchema = z.object({
	id: str('', 'Unique id (edges refer to it)'),
	x: num(0, 'Left edge (canvas units)', -10000, 10000),
	y: num(0, 'Top edge (canvas units)', -10000, 10000),
	w: num(300, 'Width (canvas units)', 20, 10000),
	h: num(0, 'Height (canvas units); 0 = estimated from the content', 0, 10000),
	kind: z.enum(['card', 'hub', 'gate']).default('card').describe('card; hub = an orchestrator with a turning glow rim and a bigger title; gate = a human approval step (amber, waits, then approves at `at`)'),
	title: str('Step', 'Title in the node header'),
	icon: str('', 'Emoji in the header chip (or empty)'),
	tag: str('', 'Small mono label at the right of the header (e.g. TRIGGER)'),
	rows: doc(z.array(z.string()).default([]), 'Body lines; `code` = a mono chip in the accent, **word** = accent'),
	chain: doc(z.array(z.string()).default([]), 'Sub-steps drawn as chips joined by arrows; they light one by one from `at`'),
	chainStep: num(0.22, 'Seconds between chain chips lighting', 0, 10),
	media: doc(mediaSchema.default({type: 'none', h: 0, dur: 1.2, lines: [], images: [], count: 5, label: '', to: 0}), 'Something that plays inside the node when it lights: waveform | code | timeline | lanes | images | motion'),
	wait: str('waiting for approval', 'gate: status text before `at`'),
	done: str('approved', 'gate: status text from `at`'),
	color: str('', 'Accent for this node (hex), e.g. an amber approval gate; empty = theme accent (gates default to amber)'),
	show: num(0, 'Seconds at which the node draws in (dim); 0 = on screen from frame 0 (a cover)', 0, 3600),
	at: num(-1, 'Seconds at which the node lights up (flash + check badge); -1 = stays dim', -1, 3600),
	again: doc(z.array(z.number()).default([]), 'Extra flash times (e.g. when a loop comes back to it)'),
	badge: str('✓', 'Badge text that pops above the node when it lights'),
});

const edgeSchema = z.object({
	from: str('', 'Source node id'),
	to: str('', 'Target node id'),
	out: side.default('bottom').describe('Side of the source node the wire leaves from'),
	in: side.default('top').describe('Side of the target node the wire enters'),
	outAt: num(0.5, 'Position along the source side (0-1)', 0, 1),
	inAt: num(0.5, 'Position along the target side (0-1)', 0, 1),
	route: z.enum(['curve', 'elbow']).default('curve').describe('curve = bezier; elbow = right angles with rounded corners through `via`'),
	via: num(-1, 'elbow: x (side ports left/right) or y (top/bottom) of the middle run; -1 = halfway', -1, 10000),
	at: num(-1, 'Seconds at which the pulse arrives at the target (the wire fills behind it); -1 = never runs', -1, 3600),
	dur: num(0.6, 'Seconds the pulse travels', 0.05, 30),
	again: doc(z.array(z.number()).default([]), 'Extra bright pulse runs: arrival times (e.g. one pulse tracing the whole path at the end)'),
	dashed: z.boolean().default(false).describe('Dashed wire (a side branch / optional path)'),
});

const camSchema = z.object({
	at: num(0, 'Seconds at which the camera starts moving here', 0, 3600),
	dur: num(0.9, 'Seconds the move takes', 0, 30),
	x: num(-1, 'Centre x (canvas units); -1 = canvas centre', -1, 10000),
	y: num(-1, 'Centre y (canvas units); -1 = canvas centre', -1, 10000),
	zoom: num(1, '1 = the whole canvas fits the frame', 0.1, 20),
});

const labelSchema = z.object({
	text: str('', 'Label text (mono, e.g. a lane name)'),
	x: num(0, 'Left (canvas units)', -10000, 10000),
	y: num(0, 'Baseline-ish top (canvas units)', -10000, 10000),
	size: num(15, 'Font size (canvas units)', 4, 400),
	show: num(0, 'Seconds at which it appears', 0, 3600),
});

const M0 = {type: 'none' as const, h: 0, dur: 1.2, lines: [], images: [], count: 5, label: '', to: 0};
const N0 = {h: 0, kind: 'card' as const, tag: '', rows: [] as string[], chain: [] as string[], chainStep: 0.22, media: M0, wait: 'waiting for approval', done: 'approved', color: '', show: 0, again: [] as number[], badge: '✓'};
const E0 = {outAt: 0.5, inAt: 0.5, route: 'curve' as const, via: -1, dur: 0.6, again: [] as number[], dashed: false};

const props = {
	canvas: doc(z.object({w: num(1080, 'Canvas width (units)', 100, 20000), h: num(1350, 'Canvas height (units)', 100, 20000)}).default({w: 1080, h: 1350}), 'The graph canvas; node, edge, label and camera coordinates are in its units'),
	nodes: doc(
		z.array(nodeSchema).default([
			{...N0, id: 'a', x: 90, y: 420, w: 400, title: 'New message', icon: '💬', tag: 'TRIGGER', rows: ['a customer writes in'], at: 0.6},
			{...N0, id: 'b', x: 590, y: 420, w: 400, kind: 'hub', title: 'AI step', icon: '✨', rows: ['`model` reads it', 'drafts a **reply**'], at: 1.5},
			{...N0, id: 'c', x: 90, y: 760, w: 520, title: 'Review', icon: '✅', chain: ['Check', 'Edit', 'Send'], at: 2.5},
			{...N0, id: 'd', x: 690, y: 760, w: 300, kind: 'gate', title: 'I approve', icon: '✋', at: 3.4},
		]),
		'Nodes: [{id, x, y, w, h, kind, title, icon, tag, rows, chain, media, wait, done, color, show, at, again, badge}]',
	),
	edges: doc(
		z.array(edgeSchema).default([
			{...E0, from: 'a', to: 'b', out: 'right', in: 'left', at: 1.5},
			{...E0, from: 'b', to: 'c', out: 'bottom', in: 'top', inAt: 0.75, at: 2.5},
			{...E0, from: 'c', to: 'd', out: 'right', in: 'left', at: 3.4},
		]),
		'Wires: [{from, to, out, in, outAt, inAt, route, via, at, dur, again, dashed}]',
	),
	camera: doc(z.array(camSchema).default([]), 'Camera keys [{at, dur, x, y, zoom}] (canvas units); none = the whole canvas'),
	labels: doc(z.array(labelSchema).default([]), 'Free mono labels on the canvas (lane names): [{text, x, y, size, show}]'),
	grid: oneOf(['dots', 'lines', 'none'] as const, 'dots', 'Canvas pattern (moves with the camera)'),
	gridSize: num(28, 'Grid spacing (canvas units)', 4, 400),
	mono: doc(z.object({family: z.string().default('Space Mono'), weight: z.number().default(700)}).default({family: 'Space Mono', weight: 700}), 'Font for tags, labels and `code` chips'),
	textSize: num(17, 'Body text size (canvas units); titles are 1.22x (hubs 1.5x)', 6, 200),
	gateColor: str('#FFB547', 'Default colour of gate nodes'),
	speed: num(1, 'Speed of the calm pulses on finished wires', 0, 10),
	hero: doc(
		z
			.object({
				at: num(-1, 'Seconds at which the hero cards fly into the graph; -1 = no hero', -1, 3600),
				dur: num(1.2, 'Seconds the flight takes', 0.1, 30),
				scale: num(1.35, 'Hero layer scale (its coordinates are design units of a 1080-wide frame / scale)', 0.2, 10),
				nodes: doc(z.array(nodeSchema).default([]), 'Hero cards (same fields as nodes), drawn big in screen space before the graph'),
				edges: doc(z.array(edgeSchema).default([]), 'Wires between hero cards'),
				to: doc(z.record(z.string(), z.array(z.string())).default({}), 'hero card id -> graph node ids it turns into (several = it splits open)'),
			})
			.default({at: -1, dur: 1.2, scale: 1.35, nodes: [], edges: [], to: {}}),
		'A simple hero version of the flow shown first (a cover): big cards with pulses; at `at` each card flies to and becomes its node(s) in the full graph while the other nodes pop in around them',
	),
};

type P = LookProps<typeof props>;
type N = P['nodes'][number];
type E = P['edges'][number];
type Media = N['media'];
type Pt = {x: number; y: number};

const HEAD = 58; // header height (canvas units)

const mediaHeight = (m: Media, ts: number) => {
	if (m.type === 'none') return 0;
	if (m.h > 0) return m.h;
	switch (m.type) {
		case 'waveform':
			return ts * 3.2;
		case 'code':
			return m.lines.length * ts * 1.45 + ts * 1.2;
		case 'timeline':
			return ts * 3.6;
		case 'lanes':
			return m.count * ts * 1.25 + ts * 0.8;
		case 'images':
			return ts * 5.5;
		default:
			return ts * 4;
	}
};

const nodeHeight = (n: N, ts: number) => {
	if (n.h > 0) return n.h;
	const head = n.kind === 'hub' ? HEAD * 1.25 : HEAD;
	const md = mediaHeight(n.media, ts);
	return head + 16 + n.rows.length * ts * 1.75 + (n.chain.length ? ts * 2.6 + 8 : 0) + (n.kind === 'gate' ? ts * 2.2 : 0) + (md ? md + 12 : 0) + 6;
};

const port = (n: N, h: number, s: z.infer<typeof side>, at: number): Pt =>
	s === 'left' ? {x: n.x, y: n.y + h * at} : s === 'right' ? {x: n.x + n.w, y: n.y + h * at} : s === 'top' ? {x: n.x + n.w * at, y: n.y} : {x: n.x + n.w * at, y: n.y + h};
const normal = (s: z.infer<typeof side>): Pt => (s === 'left' ? {x: -1, y: 0} : s === 'right' ? {x: 1, y: 0} : s === 'top' ? {x: 0, y: -1} : {x: 0, y: 1});

/** Polyline with rounded corners as an SVG path. */
const rounded = (pts: Pt[], r: number) => {
	let d = `M ${pts[0].x} ${pts[0].y}`;
	for (let i = 1; i < pts.length - 1; i++) {
		const p0 = pts[i - 1];
		const p1 = pts[i];
		const p2 = pts[i + 1];
		const l1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
		const l2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
		const rr = Math.min(r, l1 / 2, l2 / 2);
		if (rr < 0.5) {
			d += ` L ${p1.x} ${p1.y}`;
			continue;
		}
		const a = {x: p1.x - ((p1.x - p0.x) / l1) * rr, y: p1.y - ((p1.y - p0.y) / l1) * rr};
		const b = {x: p1.x + ((p2.x - p1.x) / l2) * rr, y: p1.y + ((p2.y - p1.y) / l2) * rr};
		d += ` L ${a.x} ${a.y} Q ${p1.x} ${p1.y} ${b.x} ${b.y}`;
	}
	const last = pts[pts.length - 1];
	return `${d} L ${last.x} ${last.y}`;
};

const edgePath = (e: P['edges'][number], a: Pt, b: Pt) => {
	const horiz = e.out === 'left' || e.out === 'right';
	if (e.route === 'elbow') {
		if (horiz) {
			const vx = e.via >= 0 ? e.via : (a.x + b.x) / 2;
			return rounded([a, {x: vx, y: a.y}, {x: vx, y: b.y}, b], 26);
		}
		const vy = e.via >= 0 ? e.via : (a.y + b.y) / 2;
		return rounded([a, {x: a.x, y: vy}, {x: b.x, y: vy}, b], 26);
	}
	const na = normal(e.out);
	const nb = normal(e.in);
	const k = Math.max(8, Math.hypot(b.x - a.x, b.y - a.y) * 0.45);
	return `M ${a.x} ${a.y} C ${a.x + na.x * k} ${a.y + na.y * k}, ${b.x + nb.x * k} ${b.y + nb.y * k}, ${b.x} ${b.y}`;
};

/** `code` chips and **accent** runs inside a body line. */
const Rich: React.FC<{text: string; lit: boolean; col: string; mono: React.CSSProperties; ts: number; ink: string; muted: string; light: boolean}> = ({text, lit, col, mono, ts, ink, muted, light}) => {
	const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
	return (
		<>
			{parts.map((s, i) => {
				if (s.startsWith('`'))
					return (
						<span key={i} style={{...mono, fontSize: ts * 0.88, color: lit ? (light ? ink : col) : muted, background: rgba(lit ? col : light ? '#000000' : '#FFFFFF', lit ? (light ? 0.3 : 0.12) : 0.06), border: `1px solid ${rgba(lit ? col : light ? '#000000' : '#FFFFFF', lit ? 0.35 : 0.1)}`, borderRadius: ts * 0.35, padding: `${ts * 0.05}px ${ts * 0.35}px`}}>
							{s.slice(1, -1)}
						</span>
					);
				if (s.startsWith('**'))
					return light ? (
						<span key={i} style={{color: lit ? ink : muted, fontWeight: 800, background: lit ? rgba(col, 0.6) : 'transparent', borderRadius: ts * 0.2, padding: `0 ${ts * 0.15}px`}}>{s.slice(2, -2)}</span>
					) : (
						<span key={i} style={{color: lit ? col : muted, fontWeight: 800}}>{s.slice(2, -2)}</span>
					);
				return <span key={i} style={{color: lit ? ink : muted}}>{s}</span>;
			})}
		</>
	);
};

/** The media panel inside a node: plays from the node's `at` for `media.dur` seconds. */
const MediaView: React.FC<{n: N; w: number; t: number; frame: number; fps: number; col: string; fg: string; bg: string; mono: React.CSSProperties; ts: number; light: boolean}> = ({n, w, t, frame, fps, col, fg, bg, mono, ts, light}) => {
	const tcol = light ? mix(col, '#000000', 0.45) : col;
	const m = n.media;
	const h = mediaHeight(m, ts);
	const p = n.at === 0 ? 1 : n.at > 0 ? prog(t, n.at, n.at + m.dur) : 0; // at 0 = already complete on frame 0 (a cover)
	const on = n.at >= 0 && t >= n.at;
	const dim = rgba(fg, 0.14);
	const box: React.CSSProperties = {position: 'relative', width: w, height: h, borderRadius: 10, overflow: 'hidden', background: light ? rgba(fg, 0.04) : rgba('#000000', 0.28), border: `1px solid ${rgba(fg, 0.07)}`};
	if (m.type === 'waveform') {
		const bars = Math.max(10, Math.round(m.count * 10));
		const bw = w / bars;
		return (
			<div style={box}>
				{Array.from({length: bars}, (_, i) => {
					const x = i / bars;
					const env = 0.25 + 0.75 * Math.abs(Math.sin(x * 7.3 + 0.6)) * (0.55 + 0.45 * Math.sin(x * 2.1 + 1.2));
					const base = env * (0.35 + 0.65 * rnd(`wv${n.id}${i}`));
					const live = on ? 0.85 + 0.15 * Math.sin(t * 9 + i * 0.7) : 1;
					const vis = x <= p;
					const bh = Math.max(3, base * live * (h - 14));
					return <div key={i} style={{position: 'absolute', left: i * bw + bw * 0.2, width: bw * 0.6, top: (h - bh) / 2, height: bh, borderRadius: bw, background: vis ? col : dim}} />;
				})}
				{on && p < 1 ? <div style={{position: 'absolute', left: p * w, top: 0, bottom: 0, width: 2, background: mix(col, '#FFFFFF', 0.5)}} /> : null}
			</div>
		);
	}
	if (m.type === 'code') {
		const shown = on ? Math.ceil(p * m.lines.length + 0.001) : m.lines.length;
		return (
			<div style={{...box, padding: `${ts * 0.5}px ${ts * 0.7}px`, boxSizing: 'border-box'}}>
				{m.lines.map((ln, i) => {
					const vis = !on || i < shown;
					const k = ln.match(/^(\s*-?\s*[\w.]+:)(.*)$/);
					return (
						<div key={i} style={{...mono, fontWeight: 400, fontSize: ts * 0.86, lineHeight: 1.6, whiteSpace: 'pre', opacity: vis ? 1 : 0.15}}>
							{k ? (
								<>
									<span style={{color: on ? tcol : rgba(fg, 0.4)}}>{k[1]}</span>
									<span style={{color: on ? rgba(fg, 0.85) : rgba(fg, 0.35)}}>{k[2]}</span>
								</>
							) : (
								<span style={{color: on ? rgba(fg, 0.85) : rgba(fg, 0.35)}}>{ln}</span>
							)}
						</div>
					);
				})}
			</div>
		);
	}
	if (m.type === 'timeline') {
		const ticks = 48;
		const segs = [0, 0.18, 0.41, 0.63, 0.8, 1];
		const value = Math.round(m.to * p);
		return (
			<div style={box}>
				{segs.slice(0, -1).map((s, i) => (
					<div key={i} style={{position: 'absolute', left: 10 + s * (w - 20) + 2, width: (segs[i + 1] - s) * (w - 20) - 4, top: h * 0.2, height: h * 0.26, borderRadius: 6, background: on ? rgba(col, 0.18 + 0.12 * (i % 2)) : dim, border: `1px solid ${on ? rgba(col, 0.45) : 'transparent'}`}} />
				))}
				{Array.from({length: ticks + 1}, (_, i) => (
					<div key={i} style={{position: 'absolute', left: 10 + (i / ticks) * (w - 20), top: h * 0.54, width: 1.5, height: i % 6 ? h * 0.1 : h * 0.18, background: rgba(fg, i / ticks <= p && on ? 0.7 : 0.2)}} />
				))}
				{on ? (
					<>
						<div style={{position: 'absolute', left: 10 + p * (w - 20) - 1, top: h * 0.12, width: 3, height: h * 0.66, background: mix(col, '#FFFFFF', 0.5), boxShadow: `0 0 10px ${col}`}} />
						<div style={{...mono, position: 'absolute', right: 10, bottom: h * 0.04, fontSize: ts * 0.72, color: tcol}}>{`${m.label || 'frame'} ${value}`}</div>
					</>
				) : null}
			</div>
		);
	}
	if (m.type === 'lanes') {
		const lh = ts * 1.25;
		const inner = w - ts * 4.8;
		return (
			<div style={{...box, padding: `${ts * 0.4}px ${ts * 0.6}px`, boxSizing: 'border-box'}}>
				{Array.from({length: m.count}, (_, i) => {
					const st = 0.04 * i;
					const q = on ? prog(p, st, st + 0.72 + 0.06 * Math.sin(i * 1.7)) : 0;
					return (
						<div key={i} style={{display: 'flex', alignItems: 'center', height: lh, gap: ts * 0.4}}>
							<div style={{...mono, fontWeight: 400, fontSize: ts * 0.66, color: on ? rgba(fg, 0.7) : rgba(fg, 0.35), width: ts * 3.2, whiteSpace: 'nowrap'}}>{`${m.label || 'lane'} ${i + 1}`}</div>
							<div style={{position: 'relative', width: inner, height: lh * 0.42, borderRadius: 99, background: dim, overflow: 'hidden'}}>
								<div style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: `${q * 100}%`, borderRadius: 99, background: q >= 1 ? col : rgba(col, 0.75)}} />
							</div>
						</div>
					);
				})}
			</div>
		);
	}
	if (m.type === 'images') {
		const k = Math.max(1, m.images.length);
		const gap = 8;
		const iw = (w - 16 - gap * (k - 1)) / k;
		return (
			<div style={{...box, display: 'flex', gap, padding: 8, boxSizing: 'border-box', alignItems: 'center'}}>
				{m.images.map((src, i) => {
					const at = n.at + (i / k) * m.dur;
					const e = on ? (n.at === 0 ? 1 : sp(frame, fps, at, {damping: 14, stiffness: 200})) : 0;
					return (
						<div key={i} style={{width: iw, height: h - 16, borderRadius: 8, overflow: 'hidden', background: dim, border: `1px solid ${on && e > 0.5 ? rgba(col, 0.5) : rgba(fg, 0.08)}`, flexShrink: 0}}>
							<Img src={assetSrc(src)} style={{width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: on ? Math.min(1, e) : 0.18, transform: `translateY(${(1 - Math.min(1, e)) * 18}px) scale(${0.9 + 0.1 * Math.min(1, e)})`, filter: on ? 'none' : 'grayscale(1)'}} />
						</div>
					);
				})}
			</div>
		);
	}
	if (m.type === 'motion') {
		// a tiny generic motion preview: a pill pops in, a ring draws, a bar grows (loops while lit)
		const lt = on ? (t - n.at) % 1.6 : 0;
		const pop = on ? Math.min(1, sp(Math.round(lt * fps), fps, 0, {damping: 10, stiffness: 220})) : 0;
		const ring = on ? prog(lt, 0.2, 0.9, ease.outCubic) : 0;
		const bar = on ? prog(lt, 0.4, 1.1, ease.outCubic) : 0;
		const r = h * 0.28;
		return (
			<div style={box}>
				<div style={{...mono, position: 'absolute', left: w * 0.08, top: h * 0.2, padding: `${ts * 0.2}px ${ts * 0.6}px`, borderRadius: 99, fontSize: ts * 0.8, background: on ? col : dim, color: onColor(col), transform: `scale(${on ? pop : 1})`, transformOrigin: 'left center'}}>Aa</div>
				<svg width={w} height={h} style={{position: 'absolute', inset: 0}}>
					<circle cx={w * 0.72} cy={h * 0.5} r={r} fill="none" stroke={on ? col : dim} strokeWidth={4} strokeLinecap="round" strokeDasharray={2 * Math.PI * r} strokeDashoffset={2 * Math.PI * r * (1 - (on ? ring : 1))} transform={`rotate(-90 ${w * 0.72} ${h * 0.5})`} />
				</svg>
				<div style={{position: 'absolute', left: w * 0.08, bottom: h * 0.2, width: w * 0.44 * (on ? bar : 1), height: h * 0.12, borderRadius: 99, background: on ? rgba(col, 0.7) : dim}} />
			</div>
		);
	}
	return null;
};

type Geo = {byId: Map<string, {n: N; h: number}>; edges: {e: E; a: Pt; b: Pt; d: string; L: number; col: string}[]};

const buildGeo = (nodes: N[], edges: E[], ts: number, accent: string, gateColor: string): Geo => {
	const byId = new Map<string, {n: N; h: number}>();
	nodes.forEach((n) => byId.set(n.id, {n, h: nodeHeight(n, ts)}));
	const out = edges.flatMap((e) => {
		const A = byId.get(e.from);
		const B = byId.get(e.to);
		if (!A || !B) return [];
		const a = port(A.n, A.h, e.out, e.outAt);
		const b = port(B.n, B.h, e.in, e.inAt);
		const d = edgePath(e, a, b);
		const col = B.n.color || (B.n.kind === 'gate' ? gateColor : accent);
		return [{e, a, b, d, L: Math.max(1, getLength(d)), col}];
	});
	return {byId, edges: out};
};

const FlowGraph: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const ts = p.textSize;
	const mono: React.CSSProperties = {fontFamily: sansStack(p.mono.family), fontWeight: p.mono.weight};
	const ink = theme.fg;
	const accent = theme.accent;
	const colorOf = (n: N) => n.color || (n.kind === 'gate' ? p.gateColor : accent);
	const light = luminance(theme.bg) > 0.5;
	const tone = (c: string) => (light ? mix(c, '#000000', 0.45) : c);

	const geo = useMemo(() => buildGeo(p.nodes, p.edges, ts, accent, p.gateColor), [p.nodes, p.edges, ts, accent, p.gateColor]);
	const hero = p.hero;
	const heroOn = hero.at >= 0 && hero.nodes.length > 0;
	const hgeo = useMemo(() => buildGeo(hero.nodes, hero.edges, ts, accent, p.gateColor), [hero.nodes, hero.edges, ts, accent, p.gateColor]);

	// ---- hero -> graph morph: which graph nodes each hero card turns into
	const morphOf = useMemo(() => {
		const m = new Map<string, {src: string; i: number}>();
		if (heroOn) for (const [src, ids] of Object.entries(hero.to)) ids.forEach((id, i) => m.set(id, {src, i}));
		return m;
	}, [heroOn, hero.to]);
	const landAt = (id: string) => {
		const m = morphOf.get(id);
		return m ? hero.at + hero.dur + m.i * 0.06 : -1;
	};
	/** When a graph node is on screen: morph targets land with their card, the rest pop in around them. */
	const appearAt = (n: N) => {
		if (!heroOn) return n.show;
		const land = landAt(n.id);
		if (land >= 0) return land;
		return Math.max(n.show, hero.at + hero.dur * 0.5 + rnd(`fgin${n.id}`, 0, 0.4));
	};

	// ---- camera: keys ease from one to the next; zoom interpolates in log space
	const k = Math.min(W / p.canvas.w, H / p.canvas.h);
	const keyOf = (c: {x: number; y: number; zoom: number}) => ({x: c.x < 0 ? p.canvas.w / 2 : c.x, y: c.y < 0 ? p.canvas.h / 2 : c.y, z: Math.log(c.zoom)});
	const keys = [...p.camera].sort((a, b) => a.at - b.at);
	let cam = keys.length ? keyOf(keys[0]) : keyOf({x: -1, y: -1, zoom: 1});
	for (let i = 1; i < keys.length; i++) {
		const m = ease.inOutCubic(prog(t, keys[i].at, keys[i].at + keys[i].dur));
		if (m <= 0) break;
		const nx = keyOf(keys[i]);
		cam = {x: cam.x + (nx.x - cam.x) * m, y: cam.y + (nx.y - cam.y) * m, z: cam.z + (nx.z - cam.z) * m};
	}
	const S = k * Math.exp(cam.z);
	const tx = W / 2 - cam.x * S;
	const ty = H / 2 - cam.y * S;

	// hero layer: design units * scale, a slow push-in until the morph
	const HS = u * hero.scale;
	const push = heroOn ? 1 + 0.045 * prog(t, 0, hero.at, ease.outSine) : 1;
	const heroScreen = (x: number, y: number) => ({x: W / 2 + (x * HS - W / 2) * push, y: H / 2 + (y * HS - H / 2) * push});

	const flashAt = (n: N) => {
		let f = 0;
		for (const tt of [n.at, ...n.again]) if (tt >= 0 && t >= tt) f = Math.max(f, Math.exp(-(t - tt) / 0.45));
		return f;
	};
	const period = (L: number) => Math.max(0.6, L / (260 * Math.max(0.05, p.speed)));
	const pad = 3000;
	const gridBg =
		p.grid === 'dots'
			? `radial-gradient(circle, ${rgba(theme.fg, 0.1)} ${1.3}px, transparent ${1.7}px)`
			: p.grid === 'lines'
				? `linear-gradient(${rgba(theme.fg, 0.05)} 1px, transparent 1px), linear-gradient(90deg, ${rgba(theme.fg, 0.05)} 1px, transparent 1px)`
				: 'none';

	const wires = (g: Geo, showOf: (e: E) => number, key: string, w: number, h: number) => (
		<svg width={w} height={h} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
			<defs>
				<filter id={`fgglow${key}`} x="-50%" y="-50%" width="200%" height="200%">
					<feGaussianBlur stdDeviation={6} />
				</filter>
			</defs>
			{g.edges.map(({e, d, L, col, a, b}, i) => {
				const show = showOf(e);
				if (t < show) return null;
				const draw = show <= 0 ? 1 : ease.inOutCubic(prog(t, show, show + 0.5));
				const run = e.at >= 0 ? prog(t, e.at - e.dur, e.at, ease.inOutSine) : 0;
				const done = e.at >= 0 && t >= e.at;
				const pl = Math.min(90, L * 0.35);
				const capsule = (ph: number, ck: string, strong: number, cw = 1) => (
					<g key={ck}>
						<path d={d} fill="none" stroke={col} strokeWidth={14 * cw} strokeLinecap="round" strokeDasharray={`${pl} ${L + pl}`} strokeDashoffset={-(ph * (L + pl)) + pl} opacity={0.55 * strong} filter={`url(#fgglow${key})`} />
						<path d={d} fill="none" stroke={light ? mix(col, '#000000', 0.1) : mix(col, '#FFFFFF', 0.45)} strokeWidth={4.5 * cw} strokeLinecap="round" strokeDasharray={`${pl} ${L + pl}`} strokeDashoffset={-(ph * (L + pl)) + pl} opacity={strong} />
					</g>
				);
				const loop = done ? ((t - e.at) / period(L) + i * 0.37) % 1 : -1;
				const dash = e.dashed ? '10 10' : undefined;
				return (
					<g key={`e${i}`}>
						<path d={d} fill="none" stroke={rgba(theme.fg, 0.16)} strokeWidth={2.4} strokeLinecap="round" strokeDasharray={dash ?? L} strokeDashoffset={dash ? 0 : L * (1 - draw)} opacity={dash ? draw : 1} />
						{run > 0 ? (
							<>
								<path d={d} fill="none" stroke={col} strokeWidth={8} strokeLinecap="round" strokeDasharray={`${L * run} ${L}`} opacity={0.35} filter={`url(#fgglow${key})`} />
								<path d={d} fill="none" stroke={light ? mix(col, '#000000', 0.12) : rgba(col, 0.85)} strokeWidth={light ? 3.6 : 3} strokeLinecap="round" strokeDasharray={dash ? undefined : `${L * run} ${L}`} />
							</>
						) : null}
						{run > 0 && run < 1 ? capsule(run, 'run', 1) : null}
						{loop >= 0 && t > e.at + 0.25 ? capsule(loop, 'loop', 0.6) : null}
						{e.again.map((ta, j) => {
							const r2 = prog(t, ta - e.dur, ta, ease.inOutSine);
							return r2 > 0 && r2 < 1 ? capsule(r2, `ag${j}`, 1, 1.4) : null;
						})}
						{draw > 0.9
							? [a, b].map((pt, j) => <circle key={j} cx={pt.x} cy={pt.y} r={5.5} fill={theme.bg} stroke={run > (j ? 0.98 : 0.02) ? col : rgba(theme.fg, 0.35)} strokeWidth={2.4} />)
							: null}
					</g>
				);
			})}
		</svg>
	);

	/** One node card, positioned at (n.x, n.y) inside its layer; `wrap` adds the outer transform. */
	const card = (n: N, h: number, wrap: React.CSSProperties, key: string) => {
		const lit = n.at >= 0 && t >= n.at;
		const f = flashAt(n);
		const col = colorOf(n);
		const hub = n.kind === 'hub';
		const gate = n.kind === 'gate';
		const head = hub ? HEAD * 1.25 : HEAD;
		const badge = lit ? sp(frame, fps, n.at, {damping: 11, stiffness: 230}) : 0;
		const inner = n.w - 32;
		return (
			<div key={key} style={{position: 'absolute', left: n.x, top: n.y, width: n.w, height: h, ...wrap}}>
				{lit && n.badge ? (
					<div style={{...mono, position: 'absolute', left: 6, top: -ts * 1.65, fontSize: ts * 0.78, color: tone(col), whiteSpace: 'nowrap', transform: `translateY(${(1 - badge) * 8}px)`, opacity: Math.min(1, badge)}}>
						{n.badge}
					</div>
				) : null}
				{hub ? (
					<div style={{position: 'absolute', inset: -4, borderRadius: 22, background: `conic-gradient(from ${t * 70}deg, ${rgba(col, lit ? 0.95 : 0.35)}, transparent 30%, ${rgba(col, lit ? 0.6 : 0.2)} 50%, transparent 80%, ${rgba(col, lit ? 0.95 : 0.35)})`, filter: lit ? `drop-shadow(0 0 ${14 + 20 * f}px ${rgba(col, 0.6)})` : 'none'}} />
				) : null}
				<div style={{position: 'absolute', inset: 0, borderRadius: hub ? 18 : 16, boxSizing: 'border-box', overflow: 'hidden',
					background: light ? (lit ? mix('#FFFFFF', col, gate ? 0.12 : 0) : mix(theme.bg, '#FFFFFF', 0.6)) : lit ? mix(theme.bg, gate ? col : '#FFFFFF', gate ? 0.1 : 0.075) : mix(theme.bg, '#FFFFFF', 0.04),
					border: gate ? `3px ${lit ? 'solid' : 'dashed'} ${rgba(col, lit ? 0.6 + 0.4 * f : 0.55)}` : `2px solid ${lit ? rgba(col, 0.5 + 0.5 * f) : rgba(theme.fg, hub ? 0.2 : 0.1)}`,
					boxShadow: `${light ? '0 8px 24px rgba(20,22,30,0.10)' : '0 10px 30px rgba(0,0,0,0.45)'}${lit ? `, 0 0 ${18 + 30 * f}px ${rgba(col, 0.18 + 0.5 * f)}` : ''}`,
				}}>
					<div style={{height: head, display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px', borderBottom: `1px solid ${rgba(theme.fg, 0.08)}`, background: gate ? rgba(col, 0.08) : rgba(theme.fg, 0.025)}}>
						{n.icon ? (
							<div style={{width: hub ? 44 : 34, height: hub ? 44 : 34, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: EMOJI_STACK, fontSize: hub ? 25 : 19, background: lit ? rgba(col, 0.16) : rgba(theme.fg, 0.06), border: `1px solid ${lit ? rgba(col, 0.4) : 'transparent'}`, filter: lit || gate ? 'none' : 'grayscale(1) opacity(0.55)'}}>
								{n.icon}
							</div>
						) : null}
						<div style={{...fontCss(font, {weight: hub ? 800 : 700}), fontSize: ts * (hub ? 1.5 : 1.22), color: lit ? ink : gate ? tone(col) : rgba(theme.fg, 0.6), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1}}>{n.title}</div>
						{n.tag ? <div style={{...mono, fontSize: ts * 0.7, letterSpacing: ts * 0.06, color: lit || gate ? tone(col) : rgba(theme.fg, 0.35), whiteSpace: 'nowrap'}}>{n.tag}</div> : null}
					</div>
					<div style={{padding: '10px 16px 0', display: 'flex', flexDirection: 'column', gap: ts * 0.5}}>
						{n.rows.map((r, i) => (
							<div key={i} style={{...fontCss(font, {weight: 500}), fontSize: ts, lineHeight: 1.25, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: ts * 0.3}}>
								<Rich text={r} lit={lit} col={col} mono={mono} ts={ts} ink={rgba(theme.fg, 0.86)} muted={rgba(theme.fg, 0.4)} light={light} />
							</div>
						))}
						{gate ? (
							<div style={{display: 'flex', alignItems: 'center', gap: ts * 0.5, marginTop: 2}}>
								<div style={{...fontCss(font, {weight: 800}), fontSize: ts * 0.95, padding: `${ts * 0.3}px ${ts * 0.7}px`, borderRadius: 999, display: 'flex', alignItems: 'center', gap: ts * 0.4, whiteSpace: 'nowrap',
									background: lit ? col : rgba(col, 0.1), color: lit ? onColor(col) : tone(col), border: `1px solid ${rgba(col, 0.6)}`, transform: `scale(${lit ? 0.85 + 0.15 * Math.min(1.2, badge) : 1})`}}>
									{lit ? '✓' : <span style={{width: ts * 0.5, height: ts * 0.5, borderRadius: 99, background: col, opacity: 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 7))}} />}
									{lit ? n.done : n.wait}
								</div>
							</div>
						) : null}
						{n.chain.length ? (
							<div style={{display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'nowrap'}}>
								{n.chain.map((c, i) => {
									const at = n.at >= 0 ? n.at + i * n.chainStep : -1;
									const on = at >= 0 && t >= at;
									const pop = on ? sp(frame, fps, at, {damping: 12, stiffness: 240}) : 0;
									return (
										<React.Fragment key={i}>
											{i ? <div style={{...mono, fontSize: ts * 0.9, color: on ? col : rgba(theme.fg, 0.25)}}>→</div> : null}
											<div style={{...fontCss(font, {weight: 700}), fontSize: ts * 0.92, whiteSpace: 'nowrap', padding: `${ts * 0.35}px ${ts * 0.6}px`, borderRadius: 999, color: on ? onColor(col) : rgba(theme.fg, 0.45), background: on ? col : rgba(theme.fg, 0.06), border: `1px solid ${on ? col : rgba(theme.fg, 0.12)}`, transform: `scale(${1 + 0.12 * Math.max(0, 1 - pop) * (on ? 1 : 0)})`}}>
												{c}
											</div>
										</React.Fragment>
									);
								})}
							</div>
						) : null}
						{n.media.type !== 'none' ? (
							<div style={{marginTop: 4}}>
								<MediaView n={n} w={inner} t={t} frame={frame} fps={fps} col={col} fg={theme.fg} bg={theme.bg} mono={mono} ts={ts} light={light} />
							</div>
						) : null}
					</div>
				</div>
			</div>
		);
	};

	const heroFade = heroOn ? 1 - prog(t, hero.at, hero.at + hero.dur * 0.22) : 0;
	const landedEdge = (e: E) => {
		const A = geo.byId.get(e.from);
		const B = geo.byId.get(e.to);
		return Math.max(A ? appearAt(A.n) : 0, B ? appearAt(B.n) : 0);
	};

	return (
		<AbsoluteFill style={{overflow: 'hidden'}}>
			<div style={{position: 'absolute', left: 0, top: 0, width: p.canvas.w, height: p.canvas.h, transformOrigin: '0 0', transform: `translate(${tx}px, ${ty}px) scale(${S})`}}>
				<div style={{position: 'absolute', left: -pad, top: -pad, width: p.canvas.w + 2 * pad, height: p.canvas.h + 2 * pad, backgroundImage: gridBg, backgroundSize: `${p.gridSize}px ${p.gridSize}px`, backgroundPosition: `${pad}px ${pad}px`}} />
				{p.labels.map((l, i) => {
					const show = heroOn ? Math.max(l.show, hero.at + hero.dur * 0.55) : l.show;
					return t < show ? null : (
						<div key={`l${i}`} style={{...mono, position: 'absolute', left: l.x, top: l.y, fontSize: l.size, letterSpacing: l.size * 0.12, color: rgba(theme.fg, 0.5), whiteSpace: 'nowrap', opacity: show <= 0 ? 1 : prog(t, show, show + 0.4)}}>
							{l.text}
						</div>
					);
				})}
				{wires(geo, landedEdge, 'g', p.canvas.w, p.canvas.h)}
				{p.nodes.map((n) => {
					const h = geo.byId.get(n.id)?.h ?? nodeHeight(n, ts);
					const f = flashAt(n);
					const mo = morphOf.get(n.id);
					if (heroOn && mo) {
						// fly from the hero card's rect (screen -> canvas) to the node's own rect
						const start = hero.at + mo.i * 0.06;
						if (t < start) return null;
						const m = ease.inOutCubic(prog(t, start, start + hero.dur));
						const hn = hgeo.byId.get(mo.src);
						if (m < 1 && hn) {
							const s0 = heroScreen(hn.n.x, hn.n.y);
							const sx = (s0.x - tx) / S;
							const sy = (s0.y - ty) / S;
							const sw = (hn.n.w * HS * push) / S;
							const sc = (sw + (n.w - sw) * m) / n.w;
							const x = sx + (n.x - sx) * m;
							const y = sy + (n.y - sy) * m;
							return card(n, h, {opacity: prog(t, start + hero.dur * 0.06, start + hero.dur * 0.28), transformOrigin: '0 0', transform: `translate(${x - n.x}px, ${y - n.y}px) scale(${sc})`}, n.id);
						}
						return card(n, h, {transform: `scale(${1 + 0.025 * f})`, transformOrigin: '50% 50%'}, n.id);
					}
					const show = appearAt(n);
					if (t < show) return null;
					const e = show <= 0 ? 1 : sp(frame, fps, show, {damping: 16, stiffness: 180});
					return card(n, h, {opacity: Math.min(1, e * 1.4), transform: `scale(${(0.92 + 0.08 * e) * (1 + 0.025 * f)})`, transformOrigin: '50% 50%'}, n.id);
				})}
			</div>
			{heroOn && heroFade > 0 ? (
				<div style={{position: 'absolute', left: 0, top: 0, width: W / HS, height: H / HS, transformOrigin: '0 0', opacity: heroFade,
					transform: `translate(${(W / 2) * (1 - push)}px, ${(H / 2) * (1 - push)}px) scale(${HS * push})`}}>
					{wires(hgeo, (e) => {
						const A = hgeo.byId.get(e.from);
						const B = hgeo.byId.get(e.to);
						return Math.max(A?.n.show ?? 0, B?.n.show ?? 0);
					}, 'h', W / HS, H / HS)}
					{hero.nodes.map((n, i) => {
						if (t < n.show) return null;
						const h = hgeo.byId.get(n.id)?.h ?? nodeHeight(n, ts);
						const e = n.show <= 0 ? 1 : sp(frame, fps, n.show, {damping: 16, stiffness: 180});
						const bob = Math.sin(t * 1.7 + i * 1.3) * 3;
						return card(n, h, {opacity: Math.min(1, e * 1.4), transform: `translateY(${bob}px) scale(${(0.9 + 0.1 * e) * (1 + 0.03 * flashAt(n))})`, transformOrigin: '50% 50%'}, `h${n.id}`);
					})}
				</div>
			) : null}
			<AbsoluteFill style={{background: `radial-gradient(ellipse 85% 75% at 50% 50%, transparent 60%, ${rgba(theme.bg, 0.75)} 100%)`, pointerEvents: 'none'}} />
		</AbsoluteFill>
	);
};

export const flowGraph = defineLook({
	id: 'flow-graph',
	category: 'diagram',
	kind: 'overlay',
	duration: 4,
	outro: 0,
	description:
		'A workflow canvas (n8n / node-editor style) on a dot grid that moves with the camera: nodes are cards with an icon, a title, a mono tag, body lines (`code` chips, **accent** words), optional chains of sub-step chips and an optional media panel that plays when the node lights (waveform, typed code / YAML, a frame timeline with a playhead and a real frame counter, parallel progress lanes, an image strip, a small motion preview); `kind: hub` = an orchestrator with a turning glow rim, `kind: gate` = a human approval step (amber, dashed while it waits, "approved" when it lights). Nodes draw in dim, then light up at `at` with a glow flash and a check badge while a glowing pulse runs down each wire (bezier or rounded elbow, optionally dashed) and fills it; finished wires keep calm travelling capsules, and `again` sends extra bright pulses (e.g. one pulse tracing the whole path at the end); camera keys pan and zoom across the canvas (log-space zoom). `hero` = a simple big version of the flow shown first (a moving cover: lit cards, pulses running), then at `hero.at` every hero card flies to and turns into its node(s) in the full graph (one card can split open into several) while the remaining nodes pop in around them. Coordinates are canvas units (`canvas: {w, h}`, zoom 1 = the whole canvas fits).',
	usesFont2: false,
	weights: [400, 500, 700, 800],
	extraFonts: (p) => {
		const m = (p as unknown as {mono: {family: string; weight: number}}).mono;
		return [{family: m.family, weight: m.weight}, {family: m.family, weight: 400}];
	},
	props,
	render: FlowGraph,
});
