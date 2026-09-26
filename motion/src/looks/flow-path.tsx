import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {z} from 'zod';
import {breathe, ease, lerp, map, prog, sp} from '../lib/anim';
import {liftShadow, rgba} from '../lib/color';
import {fontCss} from '../lib/fonts';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {parseRich} from '../lib/rich';
import {doc, num, str} from '../lib/schema';
import {Segs} from '../lib/text';

const nodeSchema = z.object({
	label: str('Step', 'Milestone label'),
	sub: str('', 'Small line under the label (optional)'),
});

const props = {
	nodes: doc(
		z.array(nodeSchema).default([
			{label: 'Add a trip', sub: '10 sec'},
			{label: 'Snap the ticket', sub: 'auto-filed'},
			{label: 'Find it later', sub: 'one search'},
			{label: 'Share with friends', sub: 'everyone synced'},
		]),
		'Milestones along the path: [{label, sub?}] (2-6)',
	),
	title: str('', 'Optional title above the path (**accent** markup)'),
	amplitude: num(120, 'Wave height (design units)', 0, 800),
	waves: num(1.25, 'Number of wave periods across the frame', 0, 6),
	drawDuration: num(2.4, 'Seconds for the line to draw across', 0.2, 30),
	start: num(0.25, 'Seconds before the line starts drawing', 0, 30),
	margin: num(0.08, 'Left/right margin (fraction of width)', 0, 0.4),
	labelSize: num(38, 'Label size (design units)', 10, 150),
	glow: num(0.8, 'Glow intensity 0-1', 0, 1),
	y: num(0.52, 'Vertical centre of the path (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const FlowPath: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, font2, Ds} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const x0 = p.margin * W;
	const x1 = (1 - p.margin) * W;
	const cy = p.y * H;
	const A = p.amplitude * u;
	const samples = useMemo(() => {
		const pts: {x: number; y: number; l: number}[] = [];
		const n = 160;
		let l = 0;
		for (let i = 0; i <= n; i++) {
			const f = i / n;
			const x = x0 + (x1 - x0) * f;
			const y = cy + A * Math.sin(f * Math.PI * 2 * p.waves + 0.35) * (0.55 + 0.45 * Math.sin(f * Math.PI));
			if (i > 0) l += Math.hypot(x - pts[i - 1].x, y - pts[i - 1].y);
			pts.push({x, y, l});
		}
		return pts;
	}, [x0, x1, cy, A, p.waves]);
	const L = samples[samples.length - 1].l;
	const d = useMemo(() => samples.map((s, i) => `${i ? 'L' : 'M'}${s.x.toFixed(1)},${s.y.toFixed(1)}`).join(' '), [samples]);
	const pointAt = (frac: number) => {
		const target = frac * L;
		let i = 1;
		while (i < samples.length - 1 && samples[i].l < target) i++;
		const a = samples[i - 1];
		const b = samples[i];
		const k = (target - a.l) / Math.max(1e-6, b.l - a.l);
		return {x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k)};
	};
	const xToFrac = (x: number) => {
		const s = samples.find((q) => q.x >= x) ?? samples[samples.length - 1];
		return s.l / L;
	};
	const dp = ease.inOutCubic(prog(t, p.start, p.start + p.drawDuration));
	const head = pointAt(dp);
	const n = p.nodes.length;
	const nodeFr = p.nodes.map((_, k) => xToFrac(x0 + ((k + 0.5) / n) * (x1 - x0)));
	const nodeTime = (fr: number) => {
		// invert the eased draw: find when dp reaches fr
		let lo = 0;
		let hi = 1;
		for (let i = 0; i < 20; i++) {
			const mid = (lo + hi) / 2;
			if (ease.inOutCubic(mid) < fr) lo = mid;
			else hi = mid;
		}
		return p.start + lo * p.drawDuration;
	};
	const titleRich = useMemo(() => parseRich(p.title), [p.title]);
	const titleE = ease.outExpo(prog(t, 0.05, 0.8));
	const spacing = (x1 - x0) / n;
	const fs = p.labelSize * u;
	const drift = map(t, [0, Ds], [0, 1]);
	return (
		<AbsoluteFill style={{transform: `scale(${1 + 0.015 * drift})`}}>
			{p.title ? (
				<div
					style={{
						position: 'absolute',
						left: W * 0.08,
						right: W * 0.08,
						top: cy - A - 330 * u,
						textAlign: 'center',
						...fontCss(font),
						fontSize: 72 * u,
						lineHeight: 1.05,
						letterSpacing: '-0.02em',
						color: theme.fg,
						opacity: titleE,
						transform: `translateY(${(1 - titleE) * 30 * u}px)`,
						textShadow: liftShadow(u, 0.35),
					}}
				>
					{titleRich.words.map((w, i) => (
						<React.Fragment key={i}>
							{i > 0 ? ' ' : null}
							<Segs word={w} fg={theme.fg} accent={theme.accent} font2={font2} />
						</React.Fragment>
					))}
				</div>
			) : null}
			<svg width={W} height={H} style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
				<defs>
					<linearGradient id="fpg" x1={x0} x2={x1} y1={0} y2={0} gradientUnits="userSpaceOnUse">
						<stop offset="0%" stopColor={theme.accent2} />
						<stop offset="100%" stopColor={theme.accent} />
					</linearGradient>
					<filter id="fpblur" x="-20%" y="-50%" width="140%" height="200%">
						<feGaussianBlur stdDeviation={9 * u} />
					</filter>
					<radialGradient id="fphead">
						<stop offset="0%" stopColor="#FFFFFF" stopOpacity={1} />
						<stop offset="35%" stopColor={theme.accent} stopOpacity={0.9} />
						<stop offset="100%" stopColor={theme.accent} stopOpacity={0} />
					</radialGradient>
				</defs>
				{/* future track */}
				<path d={d} fill="none" stroke={rgba(theme.fg, 0.16)} strokeWidth={3 * u} strokeDasharray={`${6 * u} ${12 * u}`} strokeLinecap="round" opacity={prog(t, 0, 0.4)} />
				{/* glow + line */}
				<path d={d} fill="none" stroke="url(#fpg)" strokeWidth={20 * u} strokeLinecap="round" strokeDasharray={L} strokeDashoffset={L * (1 - dp)} opacity={0.5 * p.glow} filter="url(#fpblur)" />
				<path d={d} fill="none" stroke="url(#fpg)" strokeWidth={8 * u} strokeLinecap="round" strokeDasharray={L} strokeDashoffset={L * (1 - dp)} />
				{dp > 0 && dp < 1 ? <circle cx={head.x} cy={head.y} r={34 * u} fill="url(#fphead)" /> : null}
			</svg>
			{p.nodes.map((node, k) => {
				const pt = pointAt(nodeFr[k]);
				const tk = nodeTime(nodeFr[k]);
				const s = sp(frame, fps, tk, {damping: 10, stiffness: 220, mass: 0.7});
				const on = t >= tk;
				const ping = on ? prog(t, tk, tk + 0.8) : 0;
				const above = k % 2 === 0;
				const le = ease.outExpo(prog(t, tk + 0.05, tk + 0.75));
				const r = 24 * u;
				return (
					<React.Fragment key={k}>
						<div style={{position: 'absolute', left: pt.x, top: pt.y, width: 0, height: 0}}>
							{ping > 0 && ping < 1 ? (
								<div style={{position: 'absolute', left: -r * (1 + 2 * ping), top: -r * (1 + 2 * ping), width: 2 * r * (1 + 2 * ping), height: 2 * r * (1 + 2 * ping), borderRadius: '50%', border: `${3 * u * (1 - ping)}px solid ${rgba(theme.accent, 0.8 * (1 - ping))}`}} />
							) : null}
							<div
								style={{
									position: 'absolute',
									left: -r,
									top: -r,
									width: 2 * r,
									height: 2 * r,
									borderRadius: '50%',
									boxSizing: 'border-box',
									background: on ? theme.bg : rgba(theme.bg, 0.6),
									border: `${5 * u}px solid ${on ? theme.accent : rgba(theme.fg, 0.25)}`,
									transform: `scale(${on ? 0.6 + 0.4 * s : 0.6})`,
									boxShadow: on ? `0 0 ${22 * u}px ${rgba(theme.accent, 0.7 * (0.7 + 0.3 * breathe(t, 2, k * 0.3)))}` : undefined,
								}}
							>
								<div style={{position: 'absolute', inset: 6 * u, borderRadius: '50%', background: on ? theme.accent : 'transparent'}} />
							</div>
						</div>
						<div
							style={{
								position: 'absolute',
								left: pt.x - spacing * 0.48,
								width: spacing * 0.96,
								...(above ? {bottom: H - pt.y + r + 22 * u} : {top: pt.y + r + 22 * u}),
								textAlign: 'center',
								opacity: le,
								transform: `translateY(${(1 - le) * (above ? 24 : -24) * u}px)`,
							}}
						>
							<div style={{...fontCss(font, {weight: 800}), fontSize: fs, lineHeight: 1.08, color: theme.fg, letterSpacing: '-0.01em', textShadow: liftShadow(u, 0.4)}}>{node.label}</div>
							{node.sub ? <div style={{...fontCss(font, {weight: 600}), fontSize: fs * 0.7, color: theme.muted, marginTop: 6 * u, textShadow: liftShadow(u, 0.3)}}>{node.sub}</div> : null}
						</div>
					</React.Fragment>
				);
			})}
		</AbsoluteFill>
	);
};

export const flowPath = defineLook({
	id: 'flow-path',
	category: 'diagram',
	kind: 'overlay',
	duration: 4,
	description: 'A glowing gradient wave draws left to right over a faint dashed track with a bright comet head; milestone nodes pop (with a ping) as the line reaches them and their labels rise in, alternating above/below.',
	weights: [600, 800],
	props,
	render: FlowPath,
});
