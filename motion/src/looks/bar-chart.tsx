import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {z} from 'zod';
import {breathe, ease, formatNumber, map, prog, resolveDecimals, sp, type NumberFormat} from '../lib/anim';
import {glowShadow, liftShadow, onColor, rgba} from '../lib/color';
import {fontCss} from '../lib/fonts';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {parseRich} from '../lib/rich';
import {bool, doc, int, num, oneOf, str} from '../lib/schema';
import {Segs} from '../lib/text';
import {FORMATS} from './stat-counter';

const barSchema = z.object({
	label: str('', 'Label under the bar'),
	value: num(0, 'Bar value', -1e12, 1e12),
	highlight: bool(false, 'Accent this bar (gradient, glow, value pill)'),
});

const props = {
	data: doc(
		z.array(barSchema).default([
			{label: 'Mon', value: 32, highlight: false},
			{label: 'Tue', value: 45, highlight: false},
			{label: 'Wed', value: 38, highlight: false},
			{label: 'Thu', value: 61, highlight: false},
			{label: 'Fri', value: 74, highlight: false},
			{label: 'Sat', value: 92, highlight: true},
		]),
		'Bars: [{label, value, highlight?}] (2-12)',
	),
	title: str('Weekly **active** users', 'Title above the chart (**accent**); empty = none'),
	format: oneOf(FORMATS, 'integer', 'Value format (see stat-counter)'),
	decimals: int(-1, 'Decimals; -1 = automatic from the values', -1, 6),
	prefix: str('', 'Value prefix'),
	suffix: str('', 'Value suffix'),
	max: num(0, 'Axis maximum (0 = auto)', 0, 1e12),
	stagger: num(0.08, 'Seconds between bars', 0, 2),
	growDuration: num(0.9, 'Seconds for a bar to grow', 0.1, 10),
	values: bool(true, 'Show value labels'),
	y: num(0.52, 'Vertical centre (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const BarChart: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, font2, landscape, Ds} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const data = p.data.slice(0, 16);
	const n = Math.max(1, data.length);
	const maxV = p.max > 0 ? p.max : Math.max(1e-9, ...data.map((d) => d.value)) * 1.12;
	const chartW = landscape ? Math.min(W * 0.66, 1500 * u) : W * 0.86;
	const chartH = landscape ? H * 0.52 : H * 0.4;
	const barGap = (chartW / n) * 0.32;
	const barW = (chartW - barGap * (n - 1)) / n;
	const dec = Math.max(0, ...data.map((d) => resolveDecimals(p.decimals, d.value, p.format as NumberFormat)));
	const fmt = (v: number) => formatNumber(v, {format: p.format as NumberFormat, decimals: dec, prefix: p.prefix, suffix: p.suffix});
	const rich = useMemo(() => parseRich(p.title), [p.title]);
	const titleE = ease.outExpo(prog(t, 0.05, 0.8));
	const axisE = ease.outCubic(prog(t, 0.1, 0.6));
	const top = p.y * H - chartH / 2;
	const left = (W - chartW) / 2;
	const vfs = Math.min(40 * u, barW * 0.36);
	const drift = map(t, [0, Ds], [0, 1]);
	return (
		<AbsoluteFill style={{transform: `scale(${1 + 0.015 * drift})`}}>
			{p.title ? (
				<div
					style={{
						position: 'absolute',
						left,
						width: chartW,
						top: top - 190 * u,
						...fontCss(font),
						fontSize: 70 * u,
						lineHeight: 1.05,
						letterSpacing: '-0.02em',
						color: theme.fg,
						opacity: titleE,
						transform: `translateY(${(1 - titleE) * 30 * u}px)`,
						textShadow: liftShadow(u, 0.35),
					}}
				>
					{rich.words.map((w, i) => (
						<React.Fragment key={i}>
							{i > 0 ? ' ' : null}
							<Segs word={w} fg={theme.fg} accent={theme.accent} font2={font2} />
						</React.Fragment>
					))}
				</div>
			) : null}
			{/* grid */}
			{[0.25, 0.5, 0.75, 1].map((g) => (
				<div key={g} style={{position: 'absolute', left, width: chartW * axisE, top: top + chartH * (1 - g), height: 1.5 * u, background: rgba(theme.fg, 0.08)}} />
			))}
			<div style={{position: 'absolute', left, width: chartW * axisE, top: top + chartH, height: 3 * u, borderRadius: 2 * u, background: rgba(theme.fg, 0.3)}} />
			{data.map((d, i) => {
				const st = 0.35 + i * p.stagger;
				const s = sp(frame, fps, st, {damping: 14, stiffness: 120, mass: 0.9});
				const e = ease.outCubic(prog(t, st, st + p.growDuration));
				const h = Math.max(0, (d.value / maxV) * chartH) * Math.max(0, s);
				const x = left + i * (barW + barGap);
				const hl = d.highlight;
				const glowB = 0.6 + 0.4 * breathe(t, 2.2);
				return (
					<React.Fragment key={i}>
						<div
							style={{
								position: 'absolute',
								left: x,
								width: barW,
								top: top + chartH - h,
								height: h,
								borderRadius: `${Math.min(18 * u, barW * 0.3)}px ${Math.min(18 * u, barW * 0.3)}px ${4 * u}px ${4 * u}px`,
								background: hl ? `linear-gradient(180deg, ${theme.accent}, ${theme.accent2})` : `linear-gradient(180deg, ${rgba(theme.fg, 0.34)}, ${rgba(theme.fg, 0.12)})`,
								boxShadow: hl ? `0 0 ${36 * u * glowB}px ${rgba(theme.accent, 0.55)}, inset 0 ${2 * u}px 0 rgba(255,255,255,0.45)` : `inset 0 ${2 * u}px 0 rgba(255,255,255,0.25)`,
							}}
						/>
						{p.values ? (
							<div
								style={{
									position: 'absolute',
									left: x - barW * 0.5,
									width: barW * 2,
									top: top + chartH - h - vfs * (hl ? 2.1 : 1.45),
									textAlign: 'center',
									opacity: prog(t, st + 0.1, st + 0.35),
								}}
							>
								<span
									style={{
										...fontCss(font, {weight: 800}),
										fontSize: vfs,
										fontVariantNumeric: 'tabular-nums',
										color: hl ? onColor(theme.accent) : theme.fg,
										background: hl ? theme.accent : 'transparent',
										padding: hl ? `${vfs * 0.18}px ${vfs * 0.42}px` : 0,
										borderRadius: vfs,
										textShadow: hl ? undefined : liftShadow(u, 0.3),
										boxShadow: hl ? `0 0 ${20 * u}px ${rgba(theme.accent, 0.5)}` : undefined,
										whiteSpace: 'nowrap',
									}}
								>
									{fmt(d.value * e)}
								</span>
							</div>
						) : null}
						<div
							style={{
								position: 'absolute',
								left: x - barGap / 2,
								width: barW + barGap,
								top: top + chartH + 16 * u,
								textAlign: 'center',
								...fontCss(font, {weight: 700}),
								fontSize: Math.min(30 * u, barW * 0.3),
								color: hl ? theme.accent : theme.muted,
								opacity: axisE,
								textShadow: hl ? glowShadow(theme.accent, 0.3, u) : undefined,
							}}
						>
							{d.label}
						</div>
					</React.Fragment>
				);
			})}
		</AbsoluteFill>
	);
};

export const barChart = defineLook({
	id: 'bar-chart',
	category: 'data',
	kind: 'overlay',
	duration: 3.5,
	description: 'Bar chart: title rises in, grid draws, bars grow on staggered springs while their values count up; the highlighted bar glows in the accent gradient with its value on an accent pill.',
	weights: [700, 800],
	props,
	render: BarChart,
});
