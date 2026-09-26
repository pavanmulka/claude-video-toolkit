import React from 'react';
import {AbsoluteFill} from 'remotion';
import {breathe, clamp01, lerp, map} from '../lib/anim';
import {rgba} from '../lib/color';
import {defineLook, useLook, useT, type LookProps} from '../lib/look';
import {bool, int, num, oneOf} from '../lib/schema';

const props = {
	position: oneOf(['top', 'bottom'] as const, 'top', 'Edge the bar sits on'),
	thickness: num(10, 'Bar thickness (design units)', 1, 80),
	inset: num(0, 'Distance from the edge (design units)', 0, 1000),
	margin: num(0, 'Left/right margin (design units)', 0, 1000),
	from: num(0, 'Progress at the start (0-1)', 0, 1),
	to: num(1, 'Progress at the end (0-1)', 0, 1),
	segments: int(0, 'Stories-style segments (0/1 = one continuous bar)', 0, 30),
	gap: num(8, 'Gap between segments (design units)', 0, 100),
	track: bool(true, 'Show the faint track behind the fill'),
	glow: num(0.8, 'Glow intensity 0-1', 0, 1),
	head: bool(true, 'Glowing head at the fill end'),
	intro: num(0.25, 'Seconds for the track to fade/grow in', 0, 5),
};

type P = LookProps<typeof props>;

const Bar: React.FC<{fill: number; p: P; showHead: boolean; t: number}> = ({fill, p, showHead, t}) => {
	const {u, theme} = useLook();
	const th = p.thickness * u;
	const f = clamp01(fill);
	const shimmerX = ((t / 1.6) % 1) * 140 - 20;
	return (
		<div style={{position: 'relative', flex: 1, height: th}}>
			{p.track ? <div style={{position: 'absolute', inset: 0, borderRadius: th, background: rgba(theme.fg, 0.22), boxShadow: `0 0 ${6 * u}px rgba(0,0,0,0.25)`}} /> : null}
			{f > 0 ? (
				<div
					style={{
						position: 'absolute',
						left: 0,
						top: 0,
						bottom: 0,
						width: `${f * 100}%`,
						minWidth: th,
						borderRadius: th,
						overflow: 'hidden',
						background: `linear-gradient(90deg, ${theme.accent2}, ${theme.accent})`,
						boxShadow: p.glow > 0 ? `0 0 ${10 * u * p.glow}px ${rgba(theme.accent, 0.75 * p.glow)}, 0 0 ${26 * u * p.glow}px ${rgba(theme.glow, 0.45 * p.glow)}` : undefined,
					}}
				>
					<div
						style={{
							position: 'absolute',
							top: 0,
							bottom: 0,
							left: `${shimmerX}%`,
							width: '22%',
							background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)',
						}}
					/>
				</div>
			) : null}
			{showHead && f > 0.002 && f < 0.999 ? (
				<div
					style={{
						position: 'absolute',
						left: `${f * 100}%`,
						top: '50%',
						width: th * 1.9,
						height: th * 1.9,
						transform: `translate(-60%, -50%) scale(${0.9 + 0.2 * breathe(t, 0.9)})`,
						borderRadius: '50%',
						background: `radial-gradient(circle, #FFFFFF 0%, #FFFFFF 30%, ${rgba(theme.accent, 0.9)} 55%, ${rgba(theme.accent, 0)} 72%)`,
						boxShadow: `0 0 ${16 * u}px ${rgba(theme.accent, 0.9 * p.glow)}`,
					}}
				/>
			) : null}
		</div>
	);
};

const ProgressBar: React.FC<{p: P}> = ({p}) => {
	const {u, Ds} = useLook();
	const t = useT();
	const progress = lerp(p.from, p.to, clamp01(t / Math.max(0.001, Ds - 1 / 30)));
	const introP = p.intro > 0 ? map(t, [0, p.intro], [0, 1]) : 1;
	const n = Math.max(1, p.segments);
	const edge = p.inset * u;
	return (
		<AbsoluteFill>
			<div
				style={{
					position: 'absolute',
					left: p.margin * u,
					right: p.margin * u,
					[p.position]: edge,
					display: 'flex',
					gap: n > 1 ? p.gap * u : 0,
					opacity: introP,
					transform: `scaleY(${0.3 + 0.7 * introP})`,
					transformOrigin: p.position === 'top' ? 'top' : 'bottom',
				}}
			>
				{Array.from({length: n}, (_, i) => (
					<Bar key={i} fill={progress * n - i} p={p} showHead={p.head && (n === 1 || Math.floor(progress * n) === i)} t={t} />
				))}
			</div>
		</AbsoluteFill>
	);
};

export const progressBar = defineLook({
	id: 'progress-bar',
	category: 'fx',
	kind: 'overlay',
	duration: 10,
	outro: 0,
	usesFont2: false,
	description: 'Thin watch-time bar on the top or bottom edge that fills across the whole duration: accent gradient, glow, shimmer and a glowing head; optional stories-style segments.',
	props,
	render: ProgressBar,
});
