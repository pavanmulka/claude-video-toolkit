// Directional motion blur for HTML content (Chrome), two variants:
//  1. Any angle, shared filters (<Blurred>, <MotionBlurDefs>, motionBlur): for many moving items.
//  2. Axis-aligned, one filter per element (<MBlurDefs>, mblurStyle, motionStd): for a few large elements
//     whose x / y smear is computed from their pose at t and half a frame earlier (180° shutter).
//
// ---------------------------------------------------------------- 1. any angle, shared filters
// An inline SVG <feGaussianBlur stdDeviation="s 0"> blurs along ONE axis. <Blurred> puts it on a square wrapper
// rotated to the direction of travel and rotates the content back, so the content stays upright and only smears
// along its velocity (any angle). Filters are shared in quantised levels: render <MotionBlurDefs> once per look.
//
//   const mb = motionBlur('my-look', u);
//   <MotionBlurDefs mb={mb} />
//   <Blurred mb={mb} x={cx} y={cy} box={side} dx={vxPerFrame} dy={vyPerFrame}>{item}</Blurred>
import React from 'react';

export type MotionBlur = {id: string; step: number; levels: number};

/** Filter set for one look: `step` px of sigma per level (scaled with the design unit), `levels` steps. */
export const motionBlur = (id: string, u: number, levels = 64): MotionBlur => ({id: id.replace(/[^a-zA-Z0-9_-]/g, ''), step: Math.max(0.5, u), levels});

/** Gaussian sigma (px) for an on-screen displacement of (dx, dy) px in one frame. strength 1 ~ a 180° shutter (box blur of half the move ~ sigma 0.15 x move). */
export const mbSigma = (dx: number, dy: number, strength = 1) => Math.hypot(dx, dy) * 0.15 * strength;

/** Hidden SVG holding the shared one-axis blur filters (ids `<id>-mb-<level>`). */
export const MotionBlurDefs: React.FC<{mb: MotionBlur}> = ({mb}) => (
	<svg width={0} height={0} aria-hidden style={{position: 'absolute', width: 0, height: 0, overflow: 'hidden'}}>
		<defs>
			{Array.from({length: mb.levels}, (_, k) => (
				<filter key={k} id={`${mb.id}-mb-${k + 1}`} x="-160%" y="-30%" width="420%" height="160%" colorInterpolationFilters="sRGB">
					<feGaussianBlur stdDeviation={`${((k + 1) * mb.step).toFixed(2)} 0`} />
				</filter>
			))}
		</defs>
	</svg>
);

/** CSS `filter` value for a blur of `sigma` px along the wrapper's x axis ('' when too small). */
export const mbFilter = (mb: MotionBlur, sigma: number) => {
	const level = Math.min(mb.levels, Math.round(sigma / mb.step));
	return level > 0 ? `url(#${mb.id}-mb-${level})` : '';
};

/**
 * Square box of side `box` centred on (x, y) px, blurred along (dx, dy) (px moved this frame).
 * `box` must contain the content at any rotation (use ~1.45x the item's longest side).
 * The blur is capped at `maxFrac` x box so fast items smear but never vanish.
 * `innerStyle` (e.g. a drop-shadow or depth blur) is applied upright, before the motion blur.
 */
export const Blurred: React.FC<{
	mb: MotionBlur;
	x: number;
	y: number;
	box: number;
	dx: number;
	dy: number;
	strength?: number;
	maxFrac?: number;
	style?: React.CSSProperties;
	innerStyle?: React.CSSProperties;
	children: React.ReactNode;
}> = ({mb, x, y, box, dx, dy, strength = 1, maxFrac = 0.45, style, innerStyle, children}) => {
	const sigma = Math.min(mbSigma(dx, dy, strength), box * maxFrac);
	const filter = strength > 0 ? mbFilter(mb, sigma) : '';
	const ang = filter ? (Math.atan2(dy, dx) * 180) / Math.PI : 0;
	return (
		<div
			style={{
				position: 'absolute',
				left: 0,
				top: 0,
				width: box,
				height: box,
				transform: `translate(${(x - box / 2).toFixed(2)}px, ${(y - box / 2).toFixed(2)}px)${ang ? ` rotate(${ang.toFixed(2)}deg)` : ''}`,
				filter: filter || undefined,
				...style,
			}}
		>
			<div
				style={{
					position: 'absolute',
					inset: 0,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					transform: ang ? `rotate(${(-ang).toFixed(2)}deg)` : undefined,
					...innerStyle,
				}}
			>
				{children}
			</div>
		</div>
	);
};

// ---------------------------------------------------------------- 2. axis-aligned, one filter per element
export type MBlur = {id: string; sx: number; sy: number; w: number; h: number};

/**
 * Gaussian std (px) for a displacement `d` (px moved over half a frame): ~ a 180° shutter smear.
 * A small dead zone keeps the slow tail of an ease perfectly crisp (no "out of focus" look while settling).
 */
export const motionStd = (d: number, gain = 1, max = Infinity, deadZone = 1.5) => Math.min(max, Math.max(0, Math.abs(d) * 0.55 * gain - deadZone));

/** Below this std (px) no filter is applied, so settled elements stay perfectly crisp. */
export const MBLUR_MIN = 0.35;

export const mblurActive = (b: Pick<MBlur, 'sx' | 'sy'>) => b.sx > MBLUR_MIN || b.sy > MBLUR_MIN;

/** CSS for an element blurred by filter `id` (nothing when the blur is negligible). */
export const mblurStyle = (b: Pick<MBlur, 'id' | 'sx' | 'sy'>): React.CSSProperties => (mblurActive(b) ? {filter: `url(#${b.id})`} : {});

/** One <filter>; the filter region grows with the blur so long smears are never clipped. `w`/`h` = element size in its own px. */
export const MBlurFilter: React.FC<{b: MBlur}> = ({b}) => {
	if (!mblurActive(b)) return null;
	const mx = Math.min(8, (3.2 * b.sx) / Math.max(1, b.w) + 0.08);
	const my = Math.min(8, (3.2 * b.sy) / Math.max(1, b.h) + 0.08);
	return (
		<filter id={b.id} x={-mx} y={-my} width={1 + 2 * mx} height={1 + 2 * my} filterUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
			<feGaussianBlur stdDeviation={`${Math.max(0, b.sx).toFixed(2)} ${Math.max(0, b.sy).toFixed(2)}`} edgeMode="none" />
		</filter>
	);
};

/** A zero-size SVG holding the filters of every blurred element of a look (render it once per frame). */
export const MBlurDefs: React.FC<{blurs: (MBlur | null | undefined)[]}> = ({blurs}) => (
	<svg width={0} height={0} style={{position: 'absolute', left: 0, top: 0, width: 0, height: 0, overflow: 'hidden'}} aria-hidden>
		<defs>{blurs.map((b) => (b ? <MBlurFilter key={b.id} b={b} /> : null))}</defs>
	</svg>
);
