import {z} from 'zod';
import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {clamp01, ease, rnd} from '../lib/anim';
import {rgba} from '../lib/color';
import {EMOJI_STACK} from '../lib/fonts';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {bool, doc, int, num, point, strList} from '../lib/schema';

const props = {
	emojis: strList(['❤️', '✨', '🎉', '💜', '⭐'], 'Emoji characters (Apple Color Emoji) to burst'),
	count: int(30, 'Emoji particles per burst', 0, 300),
	confetti: int(28, 'Confetti pieces per burst (theme colours)', 0, 400),
	bursts: doc(z.array(z.number()).default([0.08]), 'Burst start times in seconds'),
	origin: point([0.5, 0.64], 'Burst origin as [x, y] fractions of the frame'),
	direction: num(-90, 'Main direction in degrees (-90 = up, 0 = right)', -360, 360),
	spread: num(110, 'Cone angle in degrees (360 = all around)', 0, 360),
	speed: num(1700, 'Launch speed (design units per second)', 0, 10000),
	gravity: num(2600, 'Gravity (design units per second squared)', -10000, 20000),
	size: num(78, 'Emoji size (design units)', 8, 400),
	life: num(2.1, 'Particle lifetime in seconds', 0.2, 20),
	flash: bool(true, 'Soft flash + ring at the origin'),
};

type P = LookProps<typeof props>;

// position under gravity g with linear drag k: p(t) = p0 + (g/k) t + (v0 - g/k)(1 - e^{-kt}) / k
const pos = (v0: number, g: number, k: number, t: number) => (g / k) * t + ((v0 - g / k) * (1 - Math.exp(-k * t))) / k;

const EmojiBurst: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const ox = p.origin[0] * W;
	const oy = p.origin[1] * H;
	const colors = [theme.accent, theme.accent2, theme.glow, theme.fg, '#FFC94D'];
	const nodes: React.ReactNode[] = [];
	p.bursts.forEach((b0, bi) => {
		const lt0 = t - b0;
		if (lt0 < 0) return;
		if (p.flash && lt0 < 0.5) {
			const q = lt0 / 0.5;
			nodes.push(
				<div
					key={`f${bi}`}
					style={{
						position: 'absolute',
						left: ox,
						top: oy,
						width: 420 * u,
						height: 420 * u,
						transform: `translate(-50%, -50%) scale(${0.3 + 1.2 * ease.outCubic(q)})`,
						borderRadius: '50%',
						background: `radial-gradient(circle, ${rgba('#FFFFFF', 0.85)} 0%, ${rgba(theme.accent, 0.5)} 30%, transparent 68%)`,
						opacity: Math.pow(1 - q, 1.6),
					}}
				/>,
				<div
					key={`r${bi}`}
					style={{
						position: 'absolute',
						left: ox,
						top: oy,
						width: 200 * u,
						height: 200 * u,
						transform: `translate(-50%, -50%) scale(${0.5 + 3 * ease.outQuart(q)})`,
						borderRadius: '50%',
						border: `${6 * u * (1 - q)}px solid ${rgba(theme.accent, 0.8 * (1 - q))}`,
					}}
				/>,
			);
		}
		const total = p.count + p.confetti;
		for (let i = 0; i < total; i++) {
			const isEmoji = i < p.count;
			const seed = `${bi}_${i}`;
			const delay = rnd(`d${seed}`, 0, 0.08);
			const lt = lt0 - delay;
			if (lt <= 0) continue;
			const life = p.life * rnd(`l${seed}`, 0.7, 1.15);
			if (lt > life) continue;
			const ang = ((p.direction + (rnd(`a${seed}`) - 0.5) * p.spread) * Math.PI) / 180;
			const v = p.speed * u * rnd(`v${seed}`, 0.35, 1.0);
			const k = isEmoji ? rnd(`k${seed}`, 1.1, 1.8) : rnd(`k${seed}`, 2.4, 3.6);
			const g = p.gravity * u * (isEmoji ? 1 : 0.55);
			const x = ox + pos(v * Math.cos(ang), 0, k, lt) + (isEmoji ? 0 : Math.sin(lt * rnd(`w${seed}`, 5, 9)) * 18 * u);
			const y = oy + pos(v * Math.sin(ang), g, k, lt);
			const fadeIn = clamp01(lt / 0.08);
			const fadeOut = clamp01((life - lt) / (life * 0.3));
			const o = fadeIn * fadeOut;
			if (isEmoji) {
				const s = p.size * u * rnd(`s${seed}`, 0.65, 1.25);
				const pop = lt < 0.25 ? ease.outBack(clamp01(lt / 0.25)) : 1;
				const rot = rnd(`r${seed}`, -25, 25) + lt * rnd(`rw${seed}`, -160, 160);
				const ch = p.emojis[i % Math.max(1, p.emojis.length)] ?? '✨';
				nodes.push(
					<div
						key={`e${seed}`}
						style={{
							position: 'absolute',
							left: x,
							top: y,
							fontFamily: EMOJI_STACK,
							fontSize: s,
							lineHeight: 1,
							transform: `translate(-50%, -50%) rotate(${rot}deg) scale(${pop})`,
							opacity: o,
							filter: `drop-shadow(0 ${6 * u}px ${10 * u}px rgba(0,0,0,0.25))`,
						}}
					>
						{ch}
					</div>,
				);
			} else {
				const w = rnd(`cw${seed}`, 12, 20) * u;
				const h = rnd(`ch${seed}`, 22, 34) * u;
				const flip = Math.cos(lt * rnd(`cf${seed}`, 8, 16) + rnd(`cp${seed}`, 0, 6));
				const rot = rnd(`cr${seed}`, 0, 360) + lt * rnd(`crw${seed}`, -300, 300);
				const col = colors[Math.floor(rnd(`cc${seed}`, 0, colors.length))];
				nodes.push(
					<div
						key={`c${seed}`}
						style={{
							position: 'absolute',
							left: x,
							top: y,
							width: w,
							height: h,
							borderRadius: 3 * u,
							background: col,
							opacity: o,
							transform: `translate(-50%, -50%) rotate(${rot}deg) scaleY(${flip})`,
							filter: `brightness(${0.8 + 0.4 * Math.abs(flip)})`,
						}}
					/>,
				);
			}
		}
	});
	return <AbsoluteFill>{nodes}</AbsoluteFill>;
};

export const emojiBurst = defineLook({
	id: 'emoji-burst',
	category: 'fx',
	kind: 'overlay',
	duration: 2.5,
	outro: 0,
	usesFont2: false,
	description: 'Physics burst of emojis (Apple Color Emoji) and flipping confetti in theme colours from a point: launch cone, drag, gravity, spin, pop-in and fade; soft flash + ring at the origin. Several bursts via `bursts`.',
	props,
	render: EmojiBurst,
});
