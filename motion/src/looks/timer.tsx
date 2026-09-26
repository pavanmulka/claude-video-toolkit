import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {z} from 'zod';
import {breathe, ease, fmtTime, lerp, map, prog, sp} from '../lib/anim';
import {glowShadow, mix, onColor, rgba} from '../lib/color';
import {fontCss, sansStack} from '../lib/fonts';
import {CheckBadge} from '../lib/fx';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {bool, color, doc, num, oneOf, str} from '../lib/schema';
import {Anchor} from '../lib/text';

const MONO_DEFAULT = {family: 'Space Mono', weight: 700};

const itemSchema = z.object({
	label: str('Timer', 'Label above the digits'),
	from: num(0, 'Start time in seconds', 0, 360000),
	to: num(60, 'End time in seconds (smaller than from = counts down)', 0, 360000),
	tone: oneOf(['neutral', 'bad', 'good'] as const, 'neutral', 'bad = red finish, good = accent finish with a check'),
});

const props = {
	items: doc(
		z.array(itemSchema).default([
			{label: 'The old way', from: 0, to: 227, tone: 'bad'},
			{label: 'With the app', from: 0, to: 12, tone: 'good'},
		]),
		'1-3 timers shown one after another, e.g. 3:47 vs 0:12',
	),
	mono: doc(
		z
			.object({
				family: str(MONO_DEFAULT.family, 'Digit font family'),
				weight: num(MONO_DEFAULT.weight, 'Font weight', 100, 1000),
			})
			.default(MONO_DEFAULT),
		'Font for the digits (default Space Mono)',
	),
	countDuration: num(1.4, 'Seconds each count takes (ignored when realtime)', 0.1, 60),
	realtime: bool(false, 'Tick one second per second like a real call timer'),
	stagger: num(1.7, 'Seconds between timers', 0, 30),
	size: num(150, 'Digit size in design units', 20, 500),
	badColor: color('#FF5A6E', 'Colour for tone=bad'),
	vs: bool(true, 'Show a "vs" chip between two timers'),
	x: num(0.5, 'Horizontal centre (fraction of width)', 0, 1),
	y: num(0.5, 'Vertical centre (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const TimerCard: React.FC<{p: P; i: number; item: z.infer<typeof itemSchema>; t: number; frame: number}> = ({p, i, item, t, frame}) => {
	const {u, fps, theme, font, landscape} = useLook();
	const st = 0.12 + i * p.stagger;
	const inS = sp(frame, fps, st, {damping: 15, stiffness: 170, mass: 0.9});
	if (t < st) return <div style={{visibility: 'hidden'}} />;
	const c0 = st + 0.25;
	const span = Math.abs(item.to - item.from);
	const dur = p.realtime ? span : p.countDuration;
	const cp = p.realtime ? prog(t, c0, c0 + dur) : ease.inOutCubic(prog(t, c0, c0 + dur));
	const value = lerp(item.from, item.to, cp);
	const done = t >= c0 + dur;
	const since = t - (c0 + dur);
	const toneColor = item.tone === 'bad' ? p.badColor : item.tone === 'good' ? theme.accent : theme.fg;
	const colorMix = done ? Math.min(1, since / 0.25) : 0;
	const digitColor = item.tone === 'neutral' ? theme.fg : mix(theme.fg, toneColor, colorMix);
	const shakeX = done && item.tone === 'bad' && since < 0.45 ? Math.sin(since * 70) * 9 * u * (1 - since / 0.45) : 0;
	const flash = done ? Math.exp(-since / 0.4) : 0;
	const dotColor = item.tone === 'bad' ? p.badColor : item.tone === 'good' ? theme.accent : theme.accent2;
	const dotPulse = 0.55 + 0.45 * breathe(t, 1.0);
	const badge = done && item.tone !== 'neutral' ? sp(frame, fps, c0 + dur + 0.05, {damping: 11, stiffness: 220, mass: 0.7}) : 0;
	const digits = fmtTime(value);
	const fs = p.size * u;
	return (
		<div
			style={{
				position: 'relative',
				width: landscape ? 720 * u : Math.min(900 * u, 920 * u),
				padding: `${30 * u}px ${46 * u}px ${34 * u}px`,
				borderRadius: 52 * u,
				background: `linear-gradient(180deg, ${rgba(mix(theme.bg, '#FFFFFF', 0.12), 0.86)}, ${rgba(mix(theme.bg, '#000000', 0.2), 0.86)})`,
				border: `${2 * u}px solid ${rgba('#FFFFFF', 0.12)}`,
				boxShadow: `0 ${26 * u}px ${70 * u}px rgba(0,0,0,0.45), inset 0 ${2 * u}px 0 ${rgba('#FFFFFF', 0.12)}, 0 0 ${60 * u}px ${rgba(toneColor, 0.18 * (item.tone === 'neutral' ? 0 : 0.4 + flash))}`,
				opacity: Math.min(1, inS * 1.6),
				transform: `translateY(${(1 - inS) * 90 * u}px) translateX(${shakeX}px) scale(${0.9 + 0.1 * inS})`,
			}}
		>
			<div style={{display: 'flex', alignItems: 'center', gap: 18 * u}}>
				<div style={{width: 22 * u, height: 22 * u, borderRadius: '50%', background: dotColor, opacity: done ? 1 : dotPulse, boxShadow: `0 0 ${16 * u}px ${rgba(dotColor, 0.8)}`}} />
				<div style={{...fontCss(font, {weight: 700}), fontSize: 38 * u, letterSpacing: '0.06em', textTransform: 'uppercase', color: theme.muted}}>{item.label}</div>
			</div>
			<div
				style={{
					fontFamily: sansStack(p.mono.family),
					fontWeight: p.mono.weight,
					fontSize: fs,
					lineHeight: 1.05,
					marginTop: 10 * u,
					letterSpacing: '-0.02em',
					fontVariantNumeric: 'tabular-nums',
					color: digitColor,
					textShadow: item.tone === 'neutral' ? undefined : glowShadow(toneColor, colorMix * (0.35 + 0.8 * flash), u),
				}}
			>
				{digits}
			</div>
			{badge > 0 ? (
				<div style={{position: 'absolute', right: 40 * u, top: '50%', width: 96 * u, height: 96 * u, transform: `translateY(-50%) scale(${badge})`}}>
					{item.tone === 'good' ? (
						<CheckBadge p={prog(t, c0 + dur + 0.05, c0 + dur + 0.6)} size={96 * u} color={theme.accent} ink={onColor(theme.accent)} />
					) : (
						<svg width={96 * u} height={96 * u} viewBox="0 0 50 50">
							<circle cx="25" cy="25" r="22" fill={p.badColor} />
							<circle cx="25" cy="25" r="11" fill="none" stroke="#FFFFFF" strokeWidth="3.4" />
							<path d="M25 19 V25 L29 28" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" fill="none" />
						</svg>
					)}
				</div>
			) : null}
		</div>
	);
};

const Timer: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, landscape, Ds} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const items = p.items.slice(0, 3);
	const drift = map(t, [0, Ds], [0, 1]);
	return (
		<AbsoluteFill>
			<Anchor x={p.x} y={p.y} W={W} H={H} transform={`scale(${Math.min(1, (H * 0.9) / (items.length * 330 * u + 100 * u)) * (1 + 0.015 * drift)})`} style={{display: 'flex', flexDirection: landscape ? 'row' : 'column', alignItems: 'center', gap: 34 * u}}>
				{items.map((item, i) => (
					<React.Fragment key={i}>
						{i > 0 && p.vs && items.length === 2 ? (
							<div
								style={{
									...fontCss(font, {weight: 800}),
									fontSize: 40 * u,
									padding: `${8 * u}px ${26 * u}px`,
									borderRadius: 40 * u,
									color: theme.fg,
									background: rgba('#FFFFFF', 0.12),
									border: `${2 * u}px solid ${rgba('#FFFFFF', 0.16)}`,
									opacity: prog(t, 0.12 + i * p.stagger - 0.15, 0.12 + i * p.stagger + 0.1),
									transform: `scale(${0.7 + 0.3 * prog(t, 0.12 + i * p.stagger - 0.15, 0.12 + i * p.stagger + 0.1, ease.outBack)})`,
								}}
							>
								vs
							</div>
						) : null}
						<TimerCard p={p} i={i} item={item} t={t} frame={frame} />
					</React.Fragment>
				))}
			</Anchor>
		</AbsoluteFill>
	);
};

export const timer = defineLook({
	id: 'timer',
	category: 'number',
	kind: 'overlay',
	duration: 4.5,
	description: 'Call-timer style clocks (m:ss in Space Mono) that count up or down with a label and pulsing dot; compare mode shows e.g. "The old way 3:47" vs "With the app 0:12" - bad timers finish red with a shake, good ones finish in accent with a check.',
	usesFont2: false,
	weights: [700],
	extraFonts: (p) => {
		const m = (p as unknown as {mono: {family: string; weight: number}}).mono;
		return [{family: m.family, weight: m.weight}];
	},
	props,
	render: Timer,
});
