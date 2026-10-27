import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {SPRINGS, clamp01, sp} from '../lib/anim';
import {onColor, rgba} from '../lib/color';
import {fontCss} from '../lib/fonts';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {int, num, str, strList} from '../lib/schema';

const props = {
	labels: strList(['M', 'T', 'W', 'T', 'F', 'S', 'S'], 'Labels of the dots (days, steps, sessions...)'),
	lit: int(7, 'How many dots light up by the end', 0, 31),
	start: num(0.3, 'Seconds before the first dot lights', 0, 20),
	every: num(0.22, 'Seconds between dots lighting', 0.02, 5),
	size: num(96, 'Dot diameter (design units)', 10, 300),
	gap: num(18, 'Gap between dots (design units)', 0, 200),
	y: num(0.62, 'Vertical centre (fraction of height)', 0, 1),
	caption: str('', 'Small label above the row (e.g. EVERY SINGLE DAY)'),
	onColor: str('', 'Lit dot colour (empty = theme accent)'),
};

type P = LookProps<typeof props>;

const WeekTicker: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font} = useLook();
	const frame = useCurrentFrame();
	const lit = p.onColor || theme.accent;
	const s = p.size * u;
	const n = p.labels.length;
	const total = n * s + (n - 1) * p.gap * u;
	return (
		<AbsoluteFill>
			{p.caption ? (
				<div style={{position: 'absolute', top: p.y * H - s * 1.15, width: W, textAlign: 'center', ...fontCss(font), fontWeight: 800, fontSize: 28 * u, letterSpacing: 4 * u, color: theme.fg, opacity: clamp01(sp(frame, fps, 0, SPRINGS.smooth))}}>
					{p.caption}
				</div>
			) : null}
			<div style={{position: 'absolute', left: (W - total) / 2, top: p.y * H - s / 2, display: 'flex', gap: p.gap * u}}>
				{p.labels.map((l, i) => {
					const on = i < p.lit ? clamp01(sp(frame, fps, p.start + i * p.every, SPRINGS.pop)) : 0;
					const appear = clamp01(sp(frame, fps, i * 0.04, SPRINGS.smooth));
					return (
						<div key={i} style={{position: 'relative', width: s, height: s, transform: `scale(${(0.6 + 0.4 * appear) * (1 + 0.18 * Math.sin(on * Math.PI))})`, opacity: appear}}>
							<div style={{position: 'absolute', inset: 0, borderRadius: '50%', background: '#FFFFFF', boxShadow: `0 ${3 * u}px ${10 * u}px rgba(0,0,0,0.15)`}} />
							<div style={{position: 'absolute', inset: 0, borderRadius: '50%', background: lit, transform: `scale(${on})`}} />
							<div style={{position: 'absolute', inset: -6 * u, borderRadius: '50%', border: `${3 * u}px solid ${rgba(lit, 0.8 * on)}`, transform: `scale(${0.8 + 0.2 * on})`}} />
							<div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', ...fontCss(font), fontWeight: 800, fontSize: s * 0.42, color: on > 0.5 ? onColor(lit) : '#16121C'}}>
								{l}
							</div>
						</div>
					);
				})}
			</div>
		</AbsoluteFill>
	);
};

export const weekTicker = defineLook({
	id: 'week-ticker',
	category: 'number',
	kind: 'overlay',
	duration: 3,
	outro: 0.3,
	usesFont2: false,
	description: 'A row of labelled dots (M T W T F S S, steps, streak days) that light up one by one with a pop and a ring: "every single day", streaks, progress through a week.',
	props,
	render: WeekTicker,
});
