import React from 'react';
import {AbsoluteFill, spring, useCurrentFrame} from 'remotion';
import {clamp01, ease, prog} from '../lib/anim';
import {mix, rgba} from '../lib/color';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {MBlurDefs, mblurStyle, motionStd, type MBlur} from '../lib/motion-blur';
import {num, oneOf, str} from '../lib/schema';

const props = {
	color: str('', 'Door leaf colour (empty = theme accent)'),
	frameColor: str('', 'Frame colour (empty = a slightly darker shade of the leaf colour)'),
	inside: str('', 'Colour that fills the doorway once the door opens (empty = transparent: whatever is under the layer shows through, e.g. the next scene)'),
	doorWidth: num(0.42, 'Door width (outside of the frame) as a fraction of the frame width; shrinks to fit the height', 0.05, 1),
	aspect: num(2.05, 'Door height / width', 1, 4),
	openAt: num(1.4, 'Seconds until the door swings open', 0, 600),
	throughAt: num(2.6, 'Seconds until the camera flies through the doorway (0 = never: the open door holds)', 0, 600),
	angle: num(110, 'How far the leaf swings open toward the viewer, in degrees (~110 = past edge-on, as a real door)', 20, 170),
	hinge: oneOf(['right', 'left'] as const, 'right', 'Hinge side of the leaf'),
	speed: num(1, 'Animation speed multiplier (2 = twice as fast)', 0.25, 4),
	shadow: num(0.35, 'Contact shadow strength under the door 0-1', 0, 1),
	x: num(0.5, 'Horizontal centre (fraction of width)', 0, 1),
	y: num(0.5, 'Vertical centre (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;


/** Raised panel: recessed groove + raised field with soft top-left light. */
const Panel: React.FC<{left: number; top: number; w: number; h: number; base: string; u: number}> = ({left, top, w, h, base, u}) => {
	const r = Math.min(w, h) * 0.04;
	const m = Math.min(w, h) * 0.1;
	return (
		<div
			style={{
				position: 'absolute',
				left,
				top,
				width: w,
				height: h,
				borderRadius: r,
				background: mix(base, '#000000', 0.1),
				boxShadow: `inset ${2.5 * u}px ${3.5 * u}px ${5 * u}px rgba(0,0,0,0.28), inset ${-1.5 * u}px ${-2 * u}px 0 ${rgba('#FFFFFF', 0.3)}`,
			}}
		>
			<div
				style={{
					position: 'absolute',
					inset: m,
					borderRadius: r * 0.7,
					background: `linear-gradient(160deg, ${mix(base, '#FFFFFF', 0.12)} 0%, ${base} 45%, ${mix(base, '#000000', 0.05)} 100%)`,
					boxShadow: `0 ${2.5 * u}px ${5 * u}px rgba(0,0,0,0.18), inset ${1.5 * u}px ${1.5 * u}px 0 ${rgba('#FFFFFF', 0.35)}, inset ${-1.5 * u}px ${-1.5 * u}px 0 rgba(0,0,0,0.12)`,
				}}
			/>
		</div>
	);
};

const DoorReveal: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, exit} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const sp = Math.max(0.25, p.speed);
	const base = p.color || theme.accent;
	const frameC = p.frameColor || mix(base, '#000000', 0.16);
	const right = p.hinge === 'right';

	// ---- geometry (px): frame outside dw x dh, opening, leaf
	const dw = Math.min(p.doorWidth * W, (0.8 * H) / p.aspect);
	const dh = dw * p.aspect;
	const cx = p.x * W;
	const cy = p.y * H;
	const ft = dw * 0.075; // frame (casing) width
	const ow = dw - 2 * ft;
	const oh = dh - ft;
	const g = dw * 0.006;
	const lw = ow - 2 * g;
	const lh = oh - g * 1.5;
	const lx = ft + g;
	const ly = ft + g;
	const th = dw * 0.04; // leaf thickness
	const ocx = cx;
	const ocy = cy - dh / 2 + ft + oh / 2;

	// ---- timeline
	const popS = (tt: number) => (tt <= 0 ? 0 : spring({frame: tt * fps * sp, fps, config: {damping: 12, stiffness: 210, mass: 0.8}}));
	const pop = popS(t);
	const popPrev = popS(t - 0.5 / fps);
	const swingAt = (tt: number) => (tt < p.openAt ? 0 : spring({frame: (tt - p.openAt) * fps * sp, fps, config: {damping: 17, stiffness: 190, mass: 1}}));
	const a = p.angle * swingAt(t);
	const aPrev = p.angle * swingAt(t - 0.5 / fps);
	const FLY = 0.45 / sp;
	const fly = p.throughAt > 0 ? prog(t, p.throughAt, p.throughAt + FLY) : 0;
	if (fly >= 1) return null; // fully transparent once we are through
	const reach = Math.max((2 * Math.max(ocx, W - ocx)) / ow, (2 * Math.max(ocy, H - ocy)) / oh) * 1.12;
	// zoom in log space (constant perceived speed) with an accelerating curve: a slow push that rushes through
	const flyScale = (q: number) => Math.exp(Math.log(reach) * ease.inCubic(clamp01(q)));
	const S = flyScale(fly);
	const Sprev = p.throughAt > 0 ? flyScale(prog(t - 0.5 / fps, p.throughAt, p.throughAt + FLY)) : 1;
	// optional generic outro (fade) if the look ends before the fly-through
	const outroFade = 1 - exit;

	// ---- blur: zoom smear (isotropic approximation) on pop-in and fly-through; leaf smear along its swing
	const popScale = 0.72 + 0.28 * pop;
	const popVel = Math.abs(popScale - (0.72 + 0.28 * popPrev)) * dh * 0.5;
	const flyVel = Math.abs(S - Sprev) * Math.min(ow, oh) * 0.5;
	const zoomBlur = Math.min(40 * u, motionStd(popVel, 0.7) + motionStd(flyVel, 0.35));
	const leafBlur: MBlur = {id: 'door-leaf-mb', sx: motionStd((Math.abs(a - aPrev) * Math.PI) / 180 * lw * 0.5, 0.8, 26 * u), sy: 0, w: lw, h: lh};

	// ---- shading
	const rad = (a * Math.PI) / 180;
	const facing = Math.abs(Math.cos(rad));
	const backSide = a > 90;
	const dark = 0.2 * (1 - facing) + (backSide ? 0.04 : 0);
	const knobSide = right ? 'left' : 'right';
	const leafRot = right ? a : -a;
	const opening = a > 0.5;

	const jamb = (side: 'left' | 'right'): React.CSSProperties => ({
		position: 'absolute',
		top: 0,
		[side]: 0,
		width: ft,
		height: dh,
		background: `linear-gradient(90deg, ${mix(frameC, '#000000', 0.12)} 0%, ${frameC} 16%, ${mix(frameC, '#FFFFFF', 0.1)} 50%, ${frameC} 84%, ${mix(frameC, '#000000', 0.14)} 100%)`,
		boxShadow: `inset 0 0 0 ${0.8 * u}px ${rgba('#000000', 0.08)}`,
	});

	return (
		<AbsoluteFill>
			<MBlurDefs blurs={[leafBlur]} />
			<AbsoluteFill
				style={{
					transformOrigin: `${ocx}px ${ocy}px`,
					transform: `scale(${S})`,
					opacity: clamp01(prog(t, 0, 0.1 / sp) * outroFade),
					filter: zoomBlur > 0.4 ? `blur(${zoomBlur}px)` : undefined,
				}}
			>
				{/* contact shadow */}
				<div
					style={{
						position: 'absolute',
						left: cx - dw * 0.75,
						top: cy + dh / 2 - dw * 0.06,
						width: dw * 1.5,
						height: dw * 0.12,
						borderRadius: '50%',
						background: `radial-gradient(closest-side, rgba(0,0,0,${0.55 * p.shadow}) 0%, rgba(0,0,0,${0.22 * p.shadow}) 55%, transparent 100%)`,
						transform: `scale(${popScale})`,
					}}
				/>
				<div
					style={{
						position: 'absolute',
						left: cx - dw / 2,
						top: cy - dh / 2,
						width: dw,
						height: dh,
						transform: `scale(${popScale})`,
						transformOrigin: '50% 100%',
						perspective: dw * 3,
						perspectiveOrigin: `50% ${((ft + oh / 2) / dh) * 100}%`,
					}}
				>
					{/* doorway: optional fill + depth of the frame (visible once the leaf moves) */}
					{p.inside ? <div style={{position: 'absolute', left: ft, top: ft, width: ow, height: oh, background: p.inside}} /> : null}
					{opening ? (
						<>
							<div style={{position: 'absolute', left: ft, top: ft, width: ow, height: dw * 0.035, background: `linear-gradient(180deg, ${mix(frameC, '#000000', 0.35)}, ${rgba(mix(frameC, '#000000', 0.35), 0)})`}} />
							<div style={{position: 'absolute', left: ft, top: ft, width: dw * 0.03, height: oh, background: `linear-gradient(90deg, ${mix(frameC, '#000000', 0.3)}, ${rgba(mix(frameC, '#000000', 0.3), 0)})`}} />
							<div style={{position: 'absolute', left: ft + ow - dw * 0.03, top: ft, width: dw * 0.03, height: oh, background: `linear-gradient(270deg, ${mix(frameC, '#000000', 0.3)}, ${rgba(mix(frameC, '#000000', 0.3), 0)})`}} />
						</>
					) : null}
					{/* frame: two jambs + head */}
					<div style={jamb('left')} />
					<div style={jamb('right')} />
					<div
						style={{
							position: 'absolute',
							left: 0,
							top: 0,
							width: dw,
							height: ft,
							background: `linear-gradient(180deg, ${mix(frameC, '#FFFFFF', 0.12)} 0%, ${frameC} 40%, ${mix(frameC, '#000000', 0.12)} 100%)`,
							boxShadow: `inset 0 0 0 ${0.8 * u}px ${rgba('#000000', 0.08)}`,
						}}
					/>
					{/* inner casing line */}
					<div style={{position: 'absolute', left: ft - 1.5 * u, top: ft - 1.5 * u, width: ow + 3 * u, height: oh + 1.5 * u, border: `${1.5 * u}px solid ${mix(frameC, '#000000', 0.22)}`, borderBottom: 'none'}} />
					{/* leaf */}
					<div
						style={{
							position: 'absolute',
							left: lx,
							top: ly,
							width: lw,
							height: lh,
							transformOrigin: right ? '100% 50%' : '0% 50%',
							transform: `rotateY(${leafRot}deg)`,
							background: `linear-gradient(90deg, ${mix(base, '#FFFFFF', 0.08)} 0%, ${base} 35%, ${base} 70%, ${mix(base, '#000000', 0.07)} 100%)`,
							boxShadow: `inset 0 0 0 ${1 * u}px ${rgba('#000000', 0.1)}`,
							...mblurStyle(leafBlur),
						}}
					>
						<Panel left={lw * 0.13} top={lh * 0.065} w={lw * 0.74} h={lh * 0.44} base={base} u={u} />
						<Panel left={lw * 0.13} top={lh * 0.56} w={lw * 0.74} h={lh * 0.37} base={base} u={u} />
						{/* knob on the free side */}
						<div
							style={{
								position: 'absolute',
								top: lh * 0.5 - lw * 0.055,
								[knobSide]: lw * 0.045,
								width: lw * 0.11,
								height: lw * 0.11,
								borderRadius: '50%',
								background: `radial-gradient(circle at 50% 50%, ${mix(base, '#000000', 0.2)} 0%, ${mix(base, '#000000', 0.12)} 70%, ${mix(base, '#000000', 0.25)} 100%)`,
								boxShadow: `0 ${1.5 * u}px ${3 * u}px rgba(0,0,0,0.2)`,
							}}
						>
							<div
								style={{
									position: 'absolute',
									inset: '22%',
									borderRadius: '50%',
									background: 'radial-gradient(circle at 35% 30%, #FFF4D6 0%, #D9B26A 40%, #8E6A2E 100%)',
									boxShadow: `0 ${2.5 * u}px ${4 * u}px rgba(0,0,0,0.35)`,
								}}
							/>
						</div>
						{/* light: the leaf darkens as it turns away from the light */}
						{dark > 0.005 ? <div style={{position: 'absolute', inset: 0, background: `rgba(0,0,0,${dark.toFixed(3)})`}} /> : null}
					</div>
					{/* leaf thickness (free edge) */}
					{opening ? (
						<div
							style={{
								position: 'absolute',
								left: right ? lx + lw : lx,
								top: ly,
								width: th,
								height: lh,
								transformOrigin: '0% 50%',
								transform: `rotateY(${leafRot}deg) translateX(${right ? -lw : lw}px) rotateY(90deg) translateX(${-th / 2}px)`,
								background: `linear-gradient(90deg, ${mix(base, '#000000', 0.22)}, ${mix(base, '#000000', 0.12)} 50%, ${mix(base, '#000000', 0.24)})`,
							}}
						/>
					) : null}
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

export const doorReveal = defineLook({
	id: 'door-reveal',
	category: 'fx',
	kind: 'overlay',
	duration: 3.2,
	outro: 0,
	customOutro: true,
	usesFont2: false,
	description:
		'A 3D door (frame, leaf with two raised panels, brass knob, soft shading + contact shadow) pops in, swings open on its hinge toward the viewer (~110°, perspective), then the camera flies through the doorway (expo zoom with smear) and the layer ends fully transparent. The doorway is see-through (or filled with `inside`): use it as a transition into the next scene.',
	props,
	render: DoorReveal,
});
