import React, {useMemo} from 'react';
import {AbsoluteFill, Img, useCurrentFrame} from 'remotion';
import {z} from 'zod';
import {breathe, ease, prog, sp, SPRINGS} from '../lib/anim';
import {mix, rgba} from '../lib/color';
import {EMOJI_STACK, font2Css, fontCss} from '../lib/fonts';
import {assetSrc, defineLook, useLook, type LookProps} from '../lib/look';
import {measureBlock, measureText} from '../lib/measure';
import {parseRich} from '../lib/rich';
import {asset, bool, doc, num, oneOf, str} from '../lib/schema';
import {Segs} from '../lib/text';

const memberSchema = z.object({
	name: str('Member', 'Name (bold)'),
	role: str('Role', 'Job title'),
	desc: str('', 'Optional short line under the name (e.g. what they do)'),
	logo: asset('Logo / avatar image'),
	fill: z.boolean().default(false).describe('true: the image fills its tile / circle (an app icon); false: it sits on white with padding'),
});

const groupSchema = z.object({
	label: str('Team', 'Department header (shown in caps on a chip)'),
	note: str('', 'Optional small italic note after the label (e.g. "built by me")'),
	columns: num(3, 'Members per row', 1, 5),
	rows: doc(z.array(z.number().int().min(1).max(5)).default([]), 'Optional row sizes, e.g. [3, 3, 4] (overrides columns)'),
	at: num(-1, 'Seconds at which the group builds in; -1 = automatic, one after another', -1, 600),
	members: doc(z.array(memberSchema).default([]), 'Members: [{name, role, desc, logo, fill}]'),
});

const props = {
	title: str("Meet **Your** AI Team", 'Title at the top; **word** = accent. On screen from frame 0 (the cover)'),
	subtitle: str('A full team. Zero meetings.', 'Line under the title'),
	root: doc(
		z.object({
			name: str('You', 'Name under the photo'),
			role: str('Founder & CEO', 'Role pill under the photo'),
			photo: asset('Round photo'),
			at: num(0.3, 'Seconds at which the photo pops in', 0, 600),
		}).default({name: 'You', role: 'Founder & CEO', photo: '', at: 0.3}),
		'The person at the top: {name, role, photo, at}',
	),
	groups: doc(
		z.array(groupSchema).default([
			{label: 'Leadership', note: '', columns: 3, rows: [], at: -1, members: [
				{name: 'Assistant', role: 'Chief of Staff', desc: 'Plans the day', logo: '', fill: false},
				{name: 'Coder', role: 'Head of Engineering', desc: 'Ships the code', logo: '', fill: false},
				{name: 'Operator', role: 'Head of Operations', desc: 'Runs the agents', logo: '', fill: false},
			]},
			{label: 'In-house team', note: 'built by me', columns: 2, rows: [], at: -1, members: [
				{name: 'Workflow A', role: 'Head of Growth', desc: '', logo: '', fill: false},
				{name: 'Workflow B', role: 'Head of Sales', desc: '', logo: '', fill: false},
			]},
		]),
		'Departments, top to bottom: [{label, note, columns, rows, at, members: [{name, role, desc, logo, fill}]}]',
	),
	footer: str('', 'Optional line at the bottom that pops in once everything is built (e.g. "Headcount 17 · Humans 1"); **word** = accent'),
	footerAt: num(-1, 'Seconds at which the footer pops in (e.g. on a music downbeat); -1 = just after everything is built', -1, 600),
	spotlight: doc(
		z.object({
			at: num(-1, 'Seconds at which the camera starts pushing in on the person at the top (-1 = never)', -1, 600),
			dur: num(2, 'Seconds the close-up holds before the camera pulls back out', 0.2, 60),
			zoom: num(1.8, 'Close-up zoom', 1, 4),
			badge: str('', 'Emoji / short text on a sticker that pops beside the photo during the close-up (e.g. "☕")'),
			badgeAt: num(-1, 'Seconds at which the sticker pops (e.g. on the word it is about); -1 = as the camera arrives', -1, 600),
		}).default({at: -1, dur: 2, zoom: 1.8, badge: '', badgeAt: -1}),
		'Close-up on the person: {at, dur, zoom, badge}: the camera pushes in on the photo, the rest dims, rings pulse round the photo, a sticker pops beside it, then the camera pulls back to the whole chart (e.g. on a voice-over line about them)',
	),
	style: oneOf(['tree', 'cards'] as const, 'tree', 'tree: small round logos, the role above a bold name, rows hanging off elbow lines from a centre trunk (no boxes); cards: a box per member with a logo tile and the role on an accent pill'),
	logoSize: num(84, 'tree: logo circle diameter (design px)', 40, 200),
	stagger: num(0.07, 'Seconds between members popping in', 0, 2),
	groupGap: num(1.25, 'Seconds between groups when their `at` is automatic', 0.1, 10),
	pulseEvery: num(1.5, 'Seconds between pulse waves running from the person to every member (0 = no pulses)', 0, 30),
	pulseSpeed: num(900, 'Pulse speed in design px per second', 50, 5000),
	tone: oneOf(['dark', 'light'] as const, 'dark', 'Surface: dark (dark stage) or light (white cards / dark text on a light stage)'),
	grid: bool(true, 'Faint dot grid on the stage (when transparent is false)'),
};

type P = LookProps<typeof props>;

// design sizes (world px; the chart is 1080 wide and scaled to fit the frame)
const WW = 1080;
const TX = WW / 2; // trunk x
const AV = 140; // root photo
const CHIP_H = 38;
// cards style
const CMX = 30;
const CARD_H = 100;
const CGAP = 14;
const TILE = 66;
// tree style
const TMX = 18;
const TGAP = 12;
const ROLE = 26;
const NAME = 34;
const DESC = 21;

type Pt = [number, number];
/** A wire segment: drawn from `at` (seconds); `vis: false` = hidden (a pulse passing behind a member). */
type Seg = {a: Pt; b: Pt; vis: boolean; at: number};
type Member = {
	gi: number;
	mi: number;
	at: number;
	path: Seg[];
	// cards: the card rect; tree: the logo circle (x, y = top-left, w = h = diameter) + text column
	x: number;
	y: number;
	w: number;
	h: number;
	colX: number;
	colW: number;
	textY: number;
	/** tree: height of the role block, the same for a whole row so the names line up */
	roleH: number;
};

const segLen = (s: Seg) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
const pathLen = (path: Seg[]) => path.reduce((sum, s) => sum + segLen(s), 0);
/** Point at distance d along a path, and whether that spot is on a visible wire. */
const pointAt = (path: Seg[], d: number): {q: Pt; vis: boolean} => {
	for (const s of path) {
		const l = segLen(s);
		if (d <= l) {
			const m = l ? d / l : 0;
			return {q: [s.a[0] + (s.b[0] - s.a[0]) * m, s.a[1] + (s.b[1] - s.a[1]) * m], vis: s.vis};
		}
		d -= l;
	}
	const last = path[path.length - 1];
	return {q: last.b, vis: last.vis};
};
/** Names never break at a hyphen ("On-Device" stays whole). */
const noBreak = (s: string) => s.replace(/-/g, '\u2011');
const segKey = (s: Seg) => `${s.a.map((v) => v.toFixed(1))}|${s.b.map((v) => v.toFixed(1))}`;

/** Largest size <= base at which `text` fits `maxW` on one line. */
const oneLine = (text: string, style: React.CSSProperties, base: number, maxW: number) =>
	Math.min(base, (base * maxW) / Math.max(1, measureText(text, {...style, fontSize: base}).width));

const rowSizes = (n: number, columns: number, rows: number[]) => {
	if (rows.length) {
		const out: number[] = [];
		let left = n;
		for (const r of rows) {
			if (left <= 0) break;
			out.push(Math.min(r, left));
			left -= r;
		}
		while (left > 0) {
			out.push(Math.min(rows[rows.length - 1], left));
			left -= rows[rows.length - 1];
		}
		return out;
	}
	const c = Math.max(1, Math.round(columns));
	return Array.from({length: Math.ceil(n / c)}, (_, i) => Math.min(c, n - i * c));
};

const TeamChart: React.FC<{p: P}> = ({p}) => {
	const {W, H, fps, theme, font, font2, transparent} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const light = p.tone === 'light';
	const tree = p.style === 'tree';
	const ink = light ? '#141826' : theme.fg;
	const muted = theme.muted;
	const cardBg = light ? '#FFFFFF' : mix(theme.bg, '#FFFFFF', 0.07);
	const cardLine = light ? '#E4E6EE' : rgba('#FFFFFF', 0.1);
	const wire = light ? '#C9CEDB' : rgba('#FFFFFF', 0.2);
	const pillInk = '#16130A';
	const roleCss: React.CSSProperties = {...fontCss(font, {weight: 700}), lineHeight: 1.12};
	const nameCss: React.CSSProperties = {...fontCss(font, {weight: 800}), lineHeight: 1.08, letterSpacing: '-0.01em'};
	const descCss: React.CSSProperties = {...fontCss(font, {weight: 500}), lineHeight: 1.15};

	// ---- layout (world px) ----
	const L = useMemo(() => {
		const titleStyle = {...fontCss(font, {weight: 900}), letterSpacing: '-0.02em', lineHeight: 1.04};
		const titleSize = oneLine(parseRich(p.title).plain, titleStyle, 80, WW - 60 - 20);
		let y = 40;
		const titleY = y;
		y += titleSize * 1.08 + 10;
		const subY = y;
		y += p.subtitle ? 44 : 0;
		y += 30;
		const avY = y;
		y += AV;
		const pillY = y - 16;
		const nameY = pillY + 42;
		y = nameY + 46;
		const rootBottom = y;

		const members: Member[] = [];
		const chips: {gi: number; y: number; at: number}[] = [];
		const dots: {q: Pt; at: number}[] = [];
		let prefix: Seg[] = [];
		let cur: Pt = [TX, rootBottom + 4];
		let tAuto = p.root.at + 0.75;
		p.groups.forEach((g, gi) => {
			const at = g.at >= 0 ? g.at : tAuto;
			tAuto = at + p.groupGap + g.members.length * p.stagger * 0.6;
			const sizes = rowSizes(g.members.length, g.columns, g.rows);
			let mi = 0;
			sizes.forEach((n, r) => {
				const first = r === 0;
				const rowAt = at + 0.25 + mi * p.stagger;
				const drawAt = first ? at - 0.15 : rowAt - 0.25;
				// junction: the chip sits on it in a group's first row, a dot in later rows
				const J = y + (first ? (tree ? 40 : 34 + CHIP_H / 2) : tree ? 30 : 0);
				if (first) chips.push({gi, y: J, at});
				else if (tree) dots.push({q: [TX, J], at: drawAt});
				const mx = tree ? TMX : CMX;
				const gap = tree ? TGAP : CGAP;
				const cols = Math.max(n, tree ? 1 : g.columns);
				const colW = (WW - 2 * mx - (cols - 1) * gap) / cols;
				const rowW = n * colW + (n - 1) * gap;
				const x0 = (WW - rowW) / 2;
				let busY: number;
				let top: number;
				if (tree) {
					busY = J;
					top = J + (first ? CHIP_H / 2 + 22 : 26);
				} else {
					busY = first ? J + CHIP_H / 2 + 12 : y + CGAP / 2; // later card rows hang off the same columns
					top = first ? busY + 12 : y + CGAP;
				}
				const trunk: Seg = {a: cur, b: [TX, busY], vis: true, at: drawAt};
				const base = trunk.b[1] > trunk.a[1] + 0.5 ? [...prefix, trunk] : [...prefix];
				let rowBottom = top;
				let middle: Member | null = null;
				for (let k = 0; k < n; k++, mi++) {
					const m = g.members[mi];
					const colX = x0 + k * (colW + gap);
					const cx = colX + colW / 2;
					const path: Seg[] = [...base];
					if (Math.abs(cx - TX) > 0.5) path.push({a: [TX, busY], b: [cx, busY], vis: true, at: drawAt + 0.05});
					const mAt = at + 0.25 + mi * p.stagger;
					if (tree) {
						const d = p.logoSize;
						path.push({a: [cx, busY], b: [cx, top], vis: true, at: drawAt + 0.1});
						const tw = colW - 6;
						const textY = top + d + 12;
						const roleH = Math.max(...g.members.slice(mi - k, mi - k + n).map((o) => measureBlock(o.role, {...roleCss, fontSize: ROLE}, tw).height));
						let h = roleH + 4 + measureBlock(noBreak(m.name), {...nameCss, fontSize: NAME}, tw).height;
						if (m.desc) h += 6 + measureBlock(m.desc, {...descCss, fontSize: DESC}, tw).height;
						const mem: Member = {gi, mi, at: mAt, path, x: cx - d / 2, y: top, w: d, h: d, colX, colW, textY, roleH};
						members.push(mem);
						rowBottom = Math.max(rowBottom, textY + h);
						if (Math.abs(cx - TX) <= 0.5) middle = mem;
					} else {
						path.push({a: [cx, busY], b: [cx, top + CARD_H / 2], vis: true, at: drawAt + 0.1});
						members.push({gi, mi, at: mAt, path, x: colX, y: top, w: colW, h: CARD_H, colX, colW, textY: top, roleH: 0});
						rowBottom = top + CARD_H;
					}
				}
				prefix = base;
				if (tree && middle) {
					// the trunk runs on from under the middle member; a pulse passes behind it (hidden)
					const mid = middle as Member;
					const textBottom = rowBottom + 10;
					prefix = [...base, {a: [TX, busY], b: [TX, mid.y], vis: true, at: drawAt + 0.1}, {a: [TX, mid.y], b: [TX, textBottom], vis: false, at: drawAt}];
					cur = [TX, textBottom];
				} else {
					cur = [TX, busY];
				}
				y = rowBottom;
			});
			y += tree ? 10 : 0;
		});
		y += p.footer ? 110 : 40;
		// unique wires to draw
		const wires = new Map<string, Seg>();
		for (const m of members) {
			for (const s of m.path) {
				if (!s.vis) continue;
				const k = segKey(s);
				const old = wires.get(k);
				if (!old || s.at < old.at) wires.set(k, s);
			}
		}
		return {titleSize, titleY, subY, avY, pillY, nameY, members, chips, dots, wires: [...wires.values()], worldH: y};
	}, [p, font]);

	const fit = Math.min(W / WW, H / L.worldH);
	const builtAt = L.members.length ? Math.max(...L.members.map((m) => m.at)) + 0.6 : p.root.at + 0.6;
	const push = 1 + 0.025 * prog(t, 0, Math.max(1, builtAt + 6), ease.inOutSine); // slow camera push across the clip
	const spot = p.spotlight;
	const sk = spot.at >= 0 ? Math.min(prog(t, spot.at, spot.at + 0.6, ease.inOutCubic), 1 - prog(t, spot.at + spot.dur, spot.at + spot.dur + 0.7, ease.inOutCubic)) : 0;
	const S = fit * push * (1 + (spot.zoom - 1) * sk);
	const focusY = L.worldH / 2 + (L.avY + AV / 2 + 34 - L.worldH / 2) * sk; // photo + name block centre
	const ox = W / 2 - (WW / 2) * S;
	const oy = H / 2 - focusY * S;
	const X = (x: number) => ox + x * S;
	const Y = (y: number) => oy + y * S;

	const v = p.pulseSpeed;
	const pulseStart = builtAt - 0.2;
	const waves = p.pulseEvery > 0 && t > pulseStart ? Math.floor((t - pulseStart) / p.pulseEvery) + 1 : 0;
	/** Last moment a pulse reached this member: drives its glow. */
	const arrival = (m: Member) => {
		if (!waves) return -1;
		const len = pathLen(m.path);
		let last = -1;
		for (let k = 0; k < waves; k++) {
			const ta = pulseStart + k * p.pulseEvery + len / v;
			if (ta <= t) last = ta;
		}
		return last;
	};

	const rootE = sp(frame, fps, p.root.at, SPRINGS.bouncy);
	const ring = prog(t, p.root.at + 0.1, p.root.at + 0.9, ease.outCubic);
	const nameE = sp(frame, fps, p.root.at + 0.25, SPRINGS.snappy);
	const glowB = breathe(t, 2.6);
	const title = parseRich(p.title);
	const accent = theme.accent;

	return (
		<AbsoluteFill>
			{!transparent && p.grid ? (
				<AbsoluteFill
					style={{
						backgroundImage: `radial-gradient(${rgba(light ? '#1B2133' : '#FFFFFF', light ? 0.09 : 0.07)} ${1.4 * S}px, transparent ${1.6 * S}px)`,
						backgroundSize: `${28 * S}px ${28 * S}px`,
						backgroundPosition: `${ox}px ${oy}px`,
						maskImage: 'radial-gradient(ellipse 85% 75% at 50% 45%, black 30%, transparent 100%)',
					}}
				/>
			) : null}

			{/* title + subtitle: full from frame 0 */}
			<div style={{position: 'absolute', left: X(30), width: (WW - 60) * S, top: Y(L.titleY), textAlign: 'center', ...fontCss(font, {weight: 900}), fontSize: L.titleSize * S, letterSpacing: '-0.02em', lineHeight: 1.04, color: ink, whiteSpace: 'nowrap'}}>
				{title.words.map((w, i) => (
					<React.Fragment key={i}>
						{i ? ' ' : ''}
						<Segs word={w} fg={ink} accent={accent} font2={font2} />
					</React.Fragment>
				))}
			</div>
			{p.subtitle ? (
				<div style={{position: 'absolute', left: X(30), width: (WW - 60) * S, top: Y(L.subY), textAlign: 'center', ...fontCss(font, {weight: 600}), fontSize: 31 * S, color: muted, whiteSpace: 'nowrap'}}>
					{p.subtitle}
				</div>
			) : null}

			{/* wires + pulses (under the members) */}
			<svg width={W} height={H} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
				<g transform={`translate(${ox} ${oy}) scale(${S})`}>
					{L.wires.map((s) => {
						const draw = prog(t, s.at, s.at + 0.35, ease.outCubic);
						if (draw <= 0) return null;
						return (
							<line key={segKey(s)} x1={s.a[0]} y1={s.a[1]} x2={s.a[0] + (s.b[0] - s.a[0]) * draw} y2={s.a[1] + (s.b[1] - s.a[1]) * draw}
								stroke={wire} strokeWidth={2.4} strokeLinecap="round" />
						);
					})}
					{L.dots.map((d, i) => (t >= d.at ? <circle key={`j${i}`} cx={d.q[0]} cy={d.q[1]} r={5} fill={accent} opacity={prog(t, d.at, d.at + 0.3)} /> : null))}
					{waves
						? L.members.map((m) => {
								const len = pathLen(m.path);
								const out: React.ReactNode[] = [];
								for (let k = Math.max(0, waves - 3); k < waves; k++) {
									const d = (t - pulseStart - k * p.pulseEvery) * v;
									if (d < 0 || d > len) continue;
									for (let j = 0; j < 6; j++) {
										const dd = d - j * 9;
										if (dd < 0) break;
										const at = pointAt(m.path, dd);
										if (!at.vis) continue;
										out.push(<circle key={`p${k}-${j}`} cx={at.q[0]} cy={at.q[1]} r={5.2 - j * 0.6} fill={accent} opacity={(1 - j / 6) * (j ? 0.55 : 1)} />);
									}
									const head = pointAt(m.path, d);
									if (head.vis) out.push(<circle key={`h${k}`} cx={head.q[0]} cy={head.q[1]} r={14} fill={rgba(accent, 0.22)} />);
								}
								return <g key={`d${m.gi}-${m.mi}`}>{out}</g>;
							})
						: null}
				</g>
			</svg>

			{/* members */}
			{L.members.map((m) => {
				const mem = p.groups[m.gi].members[m.mi];
				if (t < m.at) return null;
				const e = sp(frame, fps, m.at, SPRINGS.snappy);
				const le = sp(frame, fps, m.at + (tree ? 0 : 0.12), SPRINGS.bouncy);
				const arr = arrival(m);
				const flash = arr >= 0 ? Math.exp(-(t - arr) / 0.45) : 0;
				const url = assetSrc(mem.logo);
				const img = url ? <Img src={url} style={mem.fill ? {width: '100%', height: '100%', objectFit: 'cover'} : {width: '70%', height: '70%', objectFit: 'contain'}} /> : null;
				if (tree) {
					const d = m.w;
					const tw = m.colW - 6;
					return (
						<React.Fragment key={`m${m.gi}-${m.mi}`}>
							<div style={{position: 'absolute', left: X(m.x), top: Y(m.y), width: d * S, height: d * S, borderRadius: '50%', overflow: 'hidden', boxSizing: 'border-box',
								background: mem.fill ? cardBg : '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center',
								border: `${2.5 * S}px solid ${flash > 0.02 ? mix(light ? '#E4E6EE' : '#3A4050', accent, flash) : light ? '#E4E6EE' : rgba('#FFFFFF', 0.22)}`,
								boxShadow: `0 ${8 * S}px ${22 * S}px rgba(0,0,0,${light ? 0.12 : 0.4}), 0 0 ${30 * S * flash}px ${rgba(accent, 0.55 * flash)}`,
								transform: `scale(${(0.3 + 0.7 * le) * (1 + 0.05 * flash)})`, opacity: Math.min(1, le * 1.8)}}>
								{img}
							</div>
							<div style={{position: 'absolute', left: X(m.colX + 3), top: Y(m.textY), width: tw * S, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
								opacity: Math.min(1, e * 1.4), transform: `translateY(${(1 - e) * 14 * S}px)`}}>
								<div style={{height: m.roleH * S, display: 'flex', alignItems: 'flex-end', justifyContent: 'center'}}>
									<div style={{...roleCss, fontSize: ROLE * S, color: accent, maxWidth: tw * S, whiteSpace: 'pre-line', textWrap: 'balance'} as React.CSSProperties}>{mem.role}</div>
								</div>
								<div style={{...nameCss, fontSize: NAME * S, color: ink, marginTop: 4 * S, maxWidth: tw * S, whiteSpace: 'pre-line', textWrap: 'balance'} as React.CSSProperties}>{noBreak(mem.name)}</div>
								{mem.desc ? <div style={{...descCss, fontSize: DESC * S, color: muted, marginTop: 6 * S, maxWidth: tw * S, whiteSpace: 'pre-line', textWrap: 'balance'} as React.CSSProperties}>{mem.desc}</div> : null}
							</div>
						</React.Fragment>
					);
				}
				const textW = m.w - 14 - TILE - 16 - 14;
				const nameSize = oneLine(mem.name, nameCss, 30, textW);
				const pillCss = fontCss(font, {weight: 700, stretch: 92});
				const roleSize = oneLine(mem.role, pillCss, 20, textW - 24);
				return (
					<div key={`m${m.gi}-${m.mi}`} style={{position: 'absolute', left: X(m.x), top: Y(m.y), width: m.w * S, height: m.h * S, boxSizing: 'border-box',
						borderRadius: 20 * S, background: cardBg, border: `${1.5 * S}px solid ${flash > 0.02 ? mix(light ? '#E4E6EE' : '#2A2F3D', accent, flash) : cardLine}`,
						boxShadow: `0 ${10 * S}px ${26 * S}px rgba(0,0,0,${light ? 0.08 : 0.35}), 0 0 ${30 * S * flash}px ${rgba(accent, 0.45 * flash)}`,
						display: 'flex', alignItems: 'center', gap: 16 * S, padding: `0 ${14 * S}px`,
						opacity: Math.min(1, e * 1.6), transform: `translateY(${(1 - e) * 26 * S}px) scale(${(0.9 + 0.1 * e) * (1 + 0.025 * flash)})`}}>
						<div style={{width: TILE * S, height: TILE * S, flexShrink: 0, borderRadius: 17 * S, overflow: 'hidden', background: mem.fill ? 'transparent' : '#FFFFFF',
							display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${0.4 + 0.6 * le})`,
							boxShadow: light ? `inset 0 0 0 ${1.5 * S}px #ECEEF3` : 'none'}}>
							{img}
						</div>
						<div style={{display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 7 * S, minWidth: 0}}>
							<div style={{...nameCss, fontSize: nameSize * S, color: ink, whiteSpace: 'nowrap'}}>{mem.name}</div>
							<div style={{...pillCss, fontSize: roleSize * S, color: pillInk, background: accent, borderRadius: 999, padding: `${3.5 * S}px ${12 * S}px`, whiteSpace: 'nowrap', lineHeight: 1.15}}>{mem.role}</div>
						</div>
					</div>
				);
			})}

			{/* department chips (over the wires) */}
			{L.chips.map((c) => {
				const g = p.groups[c.gi];
				if (t < c.at - 0.05) return null;
				const ce = sp(frame, fps, c.at, SPRINGS.pop);
				return (
					<div key={`c${c.gi}`} style={{position: 'absolute', left: X(TX), top: Y(c.y - CHIP_H / 2), height: CHIP_H * S, transform: `translateX(-50%) scale(${0.5 + 0.5 * ce})`, opacity: Math.min(1, ce * 1.6),
						display: 'flex', alignItems: 'center', gap: 10 * S, padding: `0 ${20 * S}px`, borderRadius: 999, boxSizing: 'border-box',
						background: light ? '#141826' : mix(theme.bg, '#FFFFFF', 0.12), border: `${1.5 * S}px solid ${rgba(accent, 0.55)}`,
						boxShadow: `0 0 ${22 * S}px ${rgba(accent, 0.18)}`, whiteSpace: 'nowrap'}}>
						<div style={{width: 8 * S, height: 8 * S, borderRadius: '50%', background: accent, boxShadow: `0 0 ${10 * S}px ${accent}`}} />
						<span style={{...fontCss(font, {weight: 800}), fontSize: 19 * S, letterSpacing: '0.12em', color: '#FFFFFF', textTransform: 'uppercase'}}>{g.label}</span>
						{g.note ? <span style={{...font2Css(font2), fontSize: 25 * S, color: accent, marginLeft: 2 * S}}>{g.note}</span> : null}
					</div>
				);
			})}

			{p.footer
				? (() => {
						const ft = p.footerAt >= 0 ? p.footerAt : builtAt + 0.3;
						if (t < ft) return null;
						const e = sp(frame, fps, ft, SPRINGS.pop);
						const fw = parseRich(p.footer);
						return (
							<div style={{position: 'absolute', left: X(TX), top: Y(L.worldH - 84), transform: `translateX(-50%) scale(${0.6 + 0.4 * e})`, opacity: Math.min(1, e * 1.6),
								...fontCss(font, {weight: 800}), fontSize: 27 * S, color: ink, whiteSpace: 'nowrap', padding: `${9 * S}px ${24 * S}px`, borderRadius: 999,
								border: `${1.5 * S}px dashed ${rgba(light ? '#141826' : '#FFFFFF', 0.3)}`}}>
								{fw.words.map((w, i) => (
									<React.Fragment key={i}>
										{i ? ' ' : ''}
										<Segs word={w} fg={ink} accent={accent} font2={font2} />
									</React.Fragment>
								))}
							</div>
						);
					})()
				: null}

			{/* close-up: the rest dims round the photo */}
			{sk > 0 ? (
				<AbsoluteFill style={{background: `radial-gradient(circle at ${X(TX)}px ${Y(L.avY + AV / 2 + 34)}px, transparent ${150 * S}px, ${rgba(theme.bg, 0.78 * sk)} ${290 * S}px)`}} />
			) : null}

			{/* root: photo, role pill, name */}
			{t >= p.root.at ? (
				<>
					<div style={{position: 'absolute', left: X(TX - AV / 2), top: Y(L.avY), width: AV * S, height: AV * S, transform: `scale(${0.3 + 0.7 * rootE})`, opacity: Math.min(1, rootE * 1.8)}}>
						<div style={{position: 'absolute', inset: -16 * S, borderRadius: '50%', background: `radial-gradient(circle, ${rgba(accent, 0.28 + 0.12 * glowB)} 0%, transparent 70%)`}} />
						{spot.at >= 0
							? [0, 1, 2].map((k) => {
									const pr = prog(t, spot.at + 0.3 + k * 0.55, spot.at + 1.4 + k * 0.55, ease.outCubic);
									if (pr <= 0 || pr >= 1) return null;
									return <div key={`r${k}`} style={{position: 'absolute', inset: -(AV * 0.42 * pr) * S, borderRadius: '50%', border: `${3 * S}px solid ${rgba(accent, (1 - pr) * 0.9 * sk)}`}} />;
								})
							: null}
						<svg width={(AV + 14) * S} height={(AV + 14) * S} style={{position: 'absolute', left: -7 * S, top: -7 * S, transform: 'rotate(-90deg)'}}>
							<circle cx={((AV + 14) / 2) * S} cy={((AV + 14) / 2) * S} r={((AV + 8) / 2) * S} fill="none" stroke={accent} strokeWidth={3.5 * S}
								strokeDasharray={Math.PI * (AV + 8) * S} strokeDashoffset={Math.PI * (AV + 8) * S * (1 - ring)} strokeLinecap="round" />
						</svg>
						<div style={{position: 'absolute', inset: 0, borderRadius: '50%', overflow: 'hidden', background: mix(theme.bg, '#FFFFFF', 0.85)}}>
							{p.root.photo ? <Img src={assetSrc(p.root.photo)} style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : null}
						</div>
					</div>
					<div style={{position: 'absolute', left: X(TX), top: Y(L.pillY), transform: `translateX(-50%) scale(${nameE})`, background: accent, color: pillInk, borderRadius: 999, padding: `${5 * S}px ${18 * S}px`, ...fontCss(font, {weight: 800}), fontSize: 21 * S, whiteSpace: 'nowrap', boxShadow: `0 ${6 * S}px ${18 * S}px rgba(0,0,0,0.25)`}}>
						{p.root.role}
					</div>
					<div style={{position: 'absolute', left: X(TX), top: Y(L.nameY), transform: `translateX(-50%) translateY(${(1 - nameE) * 14 * S}px)`, opacity: nameE, ...fontCss(font, {weight: 900}), fontSize: 42 * S, color: ink, whiteSpace: 'nowrap', letterSpacing: '-0.01em'}}>
						{p.root.name}
					</div>
					{spot.badge && t >= (spot.badgeAt >= 0 ? spot.badgeAt : spot.at + 0.35) && sk > 0.01
						? (() => {
								const bt = spot.badgeAt >= 0 ? spot.badgeAt : spot.at + 0.35;
								const be = sp(frame, fps, bt, SPRINGS.bouncy);
								const wob = Math.sin((t - bt) * 7) * 6 * Math.exp(-(t - bt) * 1.5);
								return (
									<div style={{position: 'absolute', left: X(TX + AV * 0.36), top: Y(L.avY - 14), width: 66 * S, height: 66 * S, borderRadius: '50%', background: '#FFFFFF',
										display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: EMOJI_STACK, fontSize: 38 * S, lineHeight: 1,
										boxShadow: `0 ${8 * S}px ${20 * S}px rgba(0,0,0,0.35), 0 0 0 ${3 * S}px ${accent}`, opacity: Math.min(1, be * 1.6) * Math.min(1, sk * 1.5),
										transform: `scale(${0.2 + 0.8 * be}) rotate(${-14 + wob}deg)`}}>
										{spot.badge}
									</div>
								);
							})()
						: null}
				</>
			) : null}

		</AbsoluteFill>
	);
};

export const teamChart = defineLook({
	id: 'team-chart',
	category: 'diagram',
	kind: 'scene',
	duration: 12,
	transparent: false,
	outro: 0,
	description:
		"A playful org chart of a team (people, tools or agents with job titles): the title is on screen from frame 0, the person at the top pops in with a ring drawing round their photo, then each department builds in turn: a header chip on the trunk, elbow wires drawing out and members popping in one after another. `style: tree` (default): small round logos with the role above a bold name (and an optional short `desc`), rows hanging off a centre trunk that runs on under each row's middle member; `style: cards`: a box per member with a logo tile and the role on an accent pill. Once everything is built, glowing pulses keep flowing from the person out to every member (passing behind middle members), each lighting up as a pulse arrives; an optional footer line pops in last; `spotlight` pushes the camera in on the person (rest dims, rings pulse, an emoji sticker pops) and back out. Laid out 1080 wide and scaled to fit any frame (4:5 for LinkedIn fits best).",
	weights: [500, 600, 700, 800, 900],
	props,
	render: TeamChart,
});
