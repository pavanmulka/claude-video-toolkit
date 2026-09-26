import {getLength, getPointAtLength} from '@remotion/paths';
import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {z} from 'zod';
import {breathe, ease, formatNumber, map, prog, resolveDecimals, sp, type NumberFormat} from '../lib/anim';
import {liftShadow, onColor, rgba} from '../lib/color';
import {fontCss} from '../lib/fonts';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {parseRich} from '../lib/rich';
import {bool, doc, int, num, oneOf, str} from '../lib/schema';
import {Segs} from '../lib/text';
import {FORMATS} from './stat-counter';

const pointSchema = z.object({
	label: str('', 'X label (optional)'),
	value: num(0, 'Value', -1e12, 1e12),
});

const props = {
	data: doc(
		z.array(pointSchema).default([
			{label: 'W1', value: 120},
			{label: 'W2', value: 180},
			{label: 'W3', value: 160},
			{label: 'W4', value: 260},
			{label: 'W5', value: 310},
			{label: 'W6', value: 290},
			{label: 'W7', value: 420},
			{label: 'W8', value: 560},
		]),
		'Points in order: [{label, value}] (2-30)',
	),
	title: str('Users **joining** every week', 'Title above the chart (**accent**); empty = none'),
	format: oneOf(FORMATS, 'integer', 'Value format (see stat-counter)'),
	decimals: int(-1, 'Decimals; -1 = automatic from the values', -1, 6),
	prefix: str('', 'Value prefix'),
	suffix: str('', 'Value suffix'),
	drawDuration: num(1.8, 'Seconds for the line to draw', 0.1, 30),
	area: bool(true, 'Gradient area under the line'),
	callout: bool(true, 'Value pill at the last point'),
	labels: bool(true, 'X labels'),
	y: num(0.52, 'Vertical centre (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const LineChart: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, font2, landscape, Ds} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const data = p.data.length >= 2 ? p.data : [...p.data, ...p.data, {label: '', value: 0}].slice(0, 2);
	const chartW = landscape ? Math.min(W * 0.66, 1500 * u) : W * 0.84;
	const chartH = landscape ? H * 0.5 : H * 0.36;
	const left = (W - chartW) / 2;
	const top = p.y * H - chartH / 2;
	const vals = data.map((d) => d.value);
	const lo = Math.min(0, ...vals);
	const hi = Math.max(...vals) * 1.12 || 1;
	const pts = data.map((d, i) => ({x: left + (i / (data.length - 1)) * chartW, y: top + chartH - ((d.value - lo) / (hi - lo)) * chartH}));
	const d = useMemo(() => {
		let s = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
		for (let i = 0; i < pts.length - 1; i++) {
			const p0 = pts[i - 1] ?? pts[i];
			const p1 = pts[i];
			const p2 = pts[i + 1];
			const p3 = pts[i + 2] ?? p2;
			const c1 = {x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6};
			const c2 = {x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6};
			s += ` C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
		}
		return s;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [JSON.stringify(pts)]);
	const L = useMemo(() => getLength(d), [d]);
	const t0 = 0.45;
	const dp = ease.inOutCubic(prog(t, t0, t0 + p.drawDuration));
	const head = getPointAtLength(d, Math.max(0.01, dp * L)) ?? pts[0];
	const areaD = `${d} L ${pts[pts.length - 1].x} ${top + chartH} L ${pts[0].x} ${top + chartH} Z`;
	const dec = Math.max(0, ...vals.map((v) => resolveDecimals(p.decimals, v, p.format as NumberFormat)));
	const fmt = (v: number) => formatNumber(v, {format: p.format as NumberFormat, decimals: dec, prefix: p.prefix, suffix: p.suffix});
	const last = pts[pts.length - 1];
	const done = t0 + p.drawDuration;
	const callS = sp(frame, fps, done - 0.1, {damping: 12, stiffness: 200, mass: 0.7});
	const ping = t > done ? ((t - done) % 1.3) / 1.3 : 0;
	const rich = useMemo(() => parseRich(p.title), [p.title]);
	const titleE = ease.outExpo(prog(t, 0.05, 0.8));
	const axisE = ease.outCubic(prog(t, 0.15, 0.7));
	const drift = map(t, [0, Ds], [0, 1]);
	const lfs = Math.min(28 * u, (chartW / data.length) * 0.4);
	return (
		<AbsoluteFill style={{transform: `scale(${1 + 0.015 * drift})`}}>
			{p.title ? (
				<div style={{position: 'absolute', left, width: chartW, top: top - 200 * u, ...fontCss(font), fontSize: 70 * u, lineHeight: 1.05, letterSpacing: '-0.02em', color: theme.fg, opacity: titleE, transform: `translateY(${(1 - titleE) * 30 * u}px)`, textShadow: liftShadow(u, 0.35)}}>
					{rich.words.map((w, i) => (
						<React.Fragment key={i}>
							{i > 0 ? ' ' : null}
							<Segs word={w} fg={theme.fg} accent={theme.accent} font2={font2} />
						</React.Fragment>
					))}
				</div>
			) : null}
			{[0.25, 0.5, 0.75, 1].map((g) => (
				<div key={g} style={{position: 'absolute', left, width: chartW * axisE, top: top + chartH * (1 - g), height: 1.5 * u, background: rgba(theme.fg, 0.08)}} />
			))}
			<div style={{position: 'absolute', left, width: chartW * axisE, top: top + chartH, height: 3 * u, background: rgba(theme.fg, 0.3), borderRadius: 2 * u}} />
			<svg width={W} height={H} style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
				<defs>
					<linearGradient id="lcs" x1={left} x2={left + chartW} y1={0} y2={0} gradientUnits="userSpaceOnUse">
						<stop offset="0%" stopColor={theme.accent2} />
						<stop offset="100%" stopColor={theme.accent} />
					</linearGradient>
					<linearGradient id="lca" x1={0} x2={0} y1={top} y2={top + chartH} gradientUnits="userSpaceOnUse">
						<stop offset="0%" stopColor={theme.accent} stopOpacity={0.42} />
						<stop offset="100%" stopColor={theme.accent} stopOpacity={0} />
					</linearGradient>
					<clipPath id="lcclip">
						<rect x={left - 20 * u} y={top - 200 * u} width={Math.max(0, head.x - left + 20 * u)} height={chartH + 400 * u} />
					</clipPath>
					<filter id="lcblur" x="-10%" y="-30%" width="120%" height="160%">
						<feGaussianBlur stdDeviation={8 * u} />
					</filter>
				</defs>
				{p.area ? <path d={areaD} fill="url(#lca)" clipPath="url(#lcclip)" /> : null}
				<path d={d} fill="none" stroke="url(#lcs)" strokeWidth={18 * u} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={L} strokeDashoffset={L * (1 - dp)} opacity={0.45} filter="url(#lcblur)" />
				<path d={d} fill="none" stroke="url(#lcs)" strokeWidth={8 * u} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={L} strokeDashoffset={L * (1 - dp)} />
				{pts.map((pt, i) => {
					const reached = head.x >= pt.x - 1;
					return reached ? <circle key={i} cx={pt.x} cy={pt.y} r={7 * u} fill={theme.bg} stroke={theme.accent} strokeWidth={3.5 * u} /> : null;
				})}
				{dp > 0 ? (
					<>
						<circle cx={head.x} cy={head.y} r={26 * u} fill={rgba(theme.accent, 0.25 + 0.1 * breathe(t, 1))} />
						<circle cx={head.x} cy={head.y} r={11 * u} fill="#FFFFFF" stroke={theme.accent} strokeWidth={4 * u} />
					</>
				) : null}
				{ping > 0 ? <circle cx={last.x} cy={last.y} r={(12 + 50 * ease.outCubic(ping)) * u} fill="none" stroke={theme.accent} strokeWidth={3 * u * (1 - ping)} opacity={1 - ping} /> : null}
			</svg>
			{p.callout && t > done - 0.1 ? (
				<div
					style={{
						position: 'absolute',
						left: Math.min(last.x, W - 40 * u),
						top: last.y - 110 * u,
						transform: `translateX(-80%) scale(${callS})`,
						transformOrigin: '80% 100%',
						...fontCss(font, {weight: 800}),
						fontSize: 44 * u,
						padding: `${10 * u}px ${26 * u}px`,
						borderRadius: 40 * u,
						background: theme.accent,
						color: onColor(theme.accent),
						boxShadow: `0 ${10 * u}px ${30 * u}px rgba(0,0,0,0.35), 0 0 ${30 * u}px ${rgba(theme.accent, 0.5)}`,
						whiteSpace: 'nowrap',
					}}
				>
					{fmt(vals[vals.length - 1] * (0.75 + 0.25 * ease.outCubic(prog(t, done - 0.1, done + 0.5))))}
				</div>
			) : null}
			{p.labels
				? data.map((dd, i) =>
						dd.label ? (
							<div key={i} style={{position: 'absolute', left: pts[i].x - 60 * u, width: 120 * u, top: top + chartH + 16 * u, textAlign: 'center', ...fontCss(font, {weight: 700}), fontSize: lfs, color: theme.muted, opacity: axisE}}>
								{dd.label}
							</div>
						) : null,
					)
				: null}
		</AbsoluteFill>
	);
};

export const lineChart = defineLook({
	id: 'line-chart',
	category: 'data',
	kind: 'overlay',
	duration: 3.5,
	description: 'Line chart: smooth gradient line draws left to right with a glowing head, points pop as it passes, a gradient area fills in behind it, and a value pill + ping lands on the final point.',
	weights: [700, 800],
	props,
	render: LineChart,
});
