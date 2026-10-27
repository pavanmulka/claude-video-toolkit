import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {SPRINGS, clamp01, sp} from '../lib/anim';
import {defineLook, useLook, useT, type LookProps} from '../lib/look';
import {int, num, strList} from '../lib/schema';

const props = {
	colors: strList(['#FF6A2B', '#FFE7CC', '#1FC6B6', '#16121C', '#FFFFFF'], 'Ring colours, outside in (empty = theme accent / accent2 / glow / fg)'),
	rings: int(5, 'Number of rings', 1, 12),
	thickness: num(46, 'Ring thickness (design units)', 4, 200),
	gap: num(0, 'Gap between rings (design units)', 0, 100),
	radius: num(0.62, 'Outer radius as a fraction of the frame width', 0.1, 2),
	x: num(0.5, 'Centre x (fraction of width)', -0.5, 1.5),
	y: num(1.02, 'Centre y (fraction of height; 1 = bottom edge, rings rise from below)', -0.5, 1.5),
	sweep: num(180, 'Arc length in degrees (180 = half circle, 360 = full ring)', 10, 360),
	rotate: num(0, 'Arc orientation in degrees (0 = opening downwards, arcs over the top)', -360, 360),
	stagger: num(0.08, 'Seconds between rings drawing on', 0, 2),
	spin: num(0, 'Slow spin in degrees per second (alternating direction)', -90, 90),
};

type P = LookProps<typeof props>;

const ArcRings: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme} = useLook();
	const frame = useCurrentFrame();
	const t = useT();
	const cols = p.colors.length ? p.colors : [theme.accent, theme.accent2, theme.glow, theme.fg];
	const cx = p.x * W;
	const cy = p.y * H;
	const R = p.radius * W;
	const th = p.thickness * u;
	const rings = Array.from({length: p.rings}, (_, i) => {
		const r = R - i * (th + p.gap * u) - th / 2;
		if (r <= th / 2) return null;
		const draw = clamp01(sp(frame, fps, i * p.stagger, SPRINGS.smooth));
		const len = (Math.PI * 2 * r * p.sweep) / 360;
		const start = -90 - p.sweep / 2 + p.rotate + (i % 2 ? -1 : 1) * p.spin * t;
		const a0 = (start * Math.PI) / 180;
		const a1 = ((start + p.sweep) * Math.PI) / 180;
		const x0 = cx + r * Math.cos(a0);
		const y0 = cy + r * Math.sin(a0);
		const x1 = cx + r * Math.cos(a1);
		const y1 = cy + r * Math.sin(a1);
		const large = p.sweep > 180 ? 1 : 0;
		const d = p.sweep >= 360 ? `M ${cx - r} ${cy} a ${r} ${r} 0 1 1 ${2 * r} 0 a ${r} ${r} 0 1 1 ${-2 * r} 0` : `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
		return (
			<path
				key={i}
				d={d}
				fill="none"
				stroke={cols[i % cols.length]}
				strokeWidth={th + 1}
				strokeDasharray={`${len} ${len}`}
				strokeDashoffset={len * (1 - draw)}
				strokeLinecap="butt"
			/>
		);
	});
	return (
		<AbsoluteFill>
			<svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>{rings}</svg>
		</AbsoluteFill>
	);
};

export const arcRings = defineLook({
	id: 'arc-rings',
	category: 'fx',
	kind: 'overlay',
	duration: 4,
	outro: 0.35,
	usesFont2: false,
	description: 'Concentric rainbow arcs (half rings by default) that draw on one after another from an edge, like a sunrise stage behind big type; colours, count, thickness, sweep, spin.',
	props,
	render: ArcRings,
});
