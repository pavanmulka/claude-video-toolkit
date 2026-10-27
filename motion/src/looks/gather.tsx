import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {z} from 'zod';
import {clamp01, ease, lerp, prog, rnd} from '../lib/anim';
import {luminance, rgba} from '../lib/color';
import {EMOJI_STACK, fontCss} from '../lib/fonts';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {Logo} from '../lib/logo';
import {asset, doc, num, oneOf, str} from '../lib/schema';

const itemSchema = z.object({
	label: str('Item', 'Card label'),
	icon: str('✨', 'Emoji (or leave empty)'),
	at: num(0, 'Seconds at which the card appears (e.g. when the voice names it)', 0, 600),
	x: num(-1, 'Card centre x (fraction of width); -1 = automatic scatter around the centre', -1, 1),
	y: num(-1, 'Card centre y (fraction of height); -1 = automatic', -1, 1),
});

const props = {
	items: doc(
		z.array(itemSchema).default([
			{label: 'Photos', icon: '📷', at: 0.2, x: -1, y: -1},
			{label: 'Emails', icon: '✉️', at: 0.5, x: -1, y: -1},
			{label: 'Notes', icon: '📝', at: 0.8, x: -1, y: -1},
			{label: 'Chats', icon: '💬', at: 1.1, x: -1, y: -1},
			{label: 'Files', icon: '📁', at: 1.4, x: -1, y: -1},
		]),
		'Scattered cards: [{label, icon, at, x, y}] (1-12); each appears at `at`, all gather into the logo at `gatherAt`',
	),
	gatherAt: num(2.4, 'Seconds at which every card glides into the centre and the logo appears', 0, 600),
	logo: asset('Logo image; empty = monogram of `name`'),
	logoShape: oneOf(['app', 'circle', 'none'] as const, 'none', 'Clip of the logo: app-icon squircle, circle, or none (the image as is)'),
	logoSize: num(230, 'Logo size (design units)', 40, 800),
	name: str('', 'Wordmark under the logo (empty = none)'),
	nameSize: num(72, 'Wordmark size (design units)', 10, 300),
	tone: oneOf(['auto', 'dark', 'light'] as const, 'auto', 'Cards: light (white, dark text: light stages), dark glass, or auto (from the theme text colour)'),
	itemSize: num(46, 'Card label size (design units)', 10, 140),
	drift: num(1, 'Idle float of the waiting cards (0 = still)', 0, 4),
	x: num(0.5, 'Gather point x (fraction of width)', 0, 1),
	y: num(0.5, 'Gather point y (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const IN = 0.5;          // card entrance (s)
const FLY = 0.62;        // card flight into the centre (s)
const STAGGER = 0.045;   // between cards when they gather

const Gather: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font} = useLook();
	const t = useCurrentFrame() / fps;
	const light = p.tone === 'light' || (p.tone === 'auto' && luminance(theme.fg) < 0.4);
	const cx = p.x * W, cy = p.y * H;
	const n = p.items.length;
	const fs = p.itemSize * u;
	const lSize = p.logoSize * u;
	const tLogo = p.gatherAt + FLY * 0.55 + STAGGER * Math.max(0, n - 1) * 0.5;

	const cards = p.items.map((it, i) => {
		// automatic scatter: an ellipse around the centre, seeded jitter so it reads as "all over the place"
		const ang = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2 + rnd(`ga${i}`, -0.25, 0.25);
		const ax = it.x >= 0 ? it.x * W : cx + Math.cos(ang) * W * rnd(`gr${i}`, 0.27, 0.34);
		const ay = it.y >= 0 ? it.y * H : cy + Math.sin(ang) * H * rnd(`gs${i}`, 0.17, 0.25);
		const e = ease.outExpo(prog(t, it.at, it.at + IN));
		const t0 = p.gatherAt + i * STAGGER;
		const f = ease.inOutExpo(prog(t, t0, t0 + FLY));
		if (e <= 0.001 || f >= 0.999) return null;
		const fl = Math.sin((t * 0.9 + rnd(`gp${i}`, 0, 6)) * 1.3) * 7 * u * p.drift * (1 - f);
		const x = lerp(ax, cx, f);
		const y = lerp(ay + (1 - e) * 28 * u + fl, cy, f);
		const sc = lerp(0.93 + 0.07 * e, 0.22, f);
		const op = e * (1 - clamp01((f - 0.55) / 0.45));
		const v = Math.abs(ease.inOutExpo(prog(t + 1 / fps, t0, t0 + FLY)) - f) * Math.hypot(ax - cx, ay - cy); // px per frame
		const blur = Math.min(10 * u, v * 0.12) + (1 - e) * 4 * u;
		return (
			<div
				key={i}
				style={{
					position: 'absolute',
					left: x,
					top: y,
					transform: `translate(-50%, -50%) scale(${sc})`,
					opacity: op,
					filter: blur > 0.3 ? `blur(${blur}px)` : undefined,
					display: 'flex',
					alignItems: 'center',
					gap: fs * 0.38,
					padding: `${fs * 0.42}px ${fs * 0.72}px`,
					borderRadius: fs * 1.2,
					background: light ? '#FFFFFF' : rgba('#FFFFFF', 0.1),
					border: light ? `${1.5 * u}px solid ${rgba(theme.fg, 0.07)}` : `${1.5 * u}px solid ${rgba('#FFFFFF', 0.18)}`,
					boxShadow: light ? `0 ${10 * u}px ${30 * u}px ${rgba(theme.fg, 0.12)}, 0 ${2 * u}px ${6 * u}px ${rgba(theme.fg, 0.06)}` : undefined,
					backdropFilter: light ? undefined : `blur(${16 * u}px)`,
					whiteSpace: 'nowrap',
				}}
			>
				{it.icon ? <span style={{fontFamily: EMOJI_STACK, fontSize: fs * 1.05, lineHeight: 1}}>{it.icon}</span> : null}
				<span style={{...fontCss(font), fontSize: fs, lineHeight: 1.1, color: theme.fg}}>{it.label}</span>
			</div>
		);
	});

	// the logo: grows out of the gather point as the cards arrive, a soft ring breathes out once
	const le = ease.outExpo(prog(t, tLogo, tLogo + 0.7));
	const ring = prog(t, tLogo + 0.05, tLogo + 1.1);
	const ne = ease.outExpo(prog(t, tLogo + 0.35, tLogo + 0.95));
	return (
		<AbsoluteFill>
			{cards}
			{ring > 0 && ring < 1 ? (
				<div
					style={{
						position: 'absolute',
						left: cx,
						top: cy,
						width: lSize,
						height: lSize,
						borderRadius: '50%',
						transform: `translate(-50%, -50%) scale(${1 + ease.outCubic(ring) * 1.1})`,
						border: `${4 * u}px solid ${rgba(theme.accent, 0.55 * (1 - ring))}`,
					}}
				/>
			) : null}
			{le > 0.001 ? (
				<div
					style={{
						position: 'absolute',
						left: cx,
						top: cy,
						transform: `translate(-50%, -50%) scale(${0.55 + 0.45 * le})`,
						opacity: clamp01(le * 1.6),
						filter: le < 0.9 ? `blur(${(1 - le) * 8 * u}px)` : undefined,
					}}
				>
					<Logo src={p.logo} name={p.name || 'App'} size={lSize} shape={p.logoShape} theme={theme} font={font} shadow={false} />
				</div>
			) : null}
			{p.name && ne > 0.001 ? (
				<div
					style={{
						position: 'absolute',
						left: cx,
						top: cy + lSize * 0.5 + p.nameSize * u * 0.9,
						transform: `translate(-50%, ${(1 - ne) * 18 * u}px)`,
						opacity: ne,
						...fontCss(font),
						fontSize: p.nameSize * u,
						color: theme.fg,
						whiteSpace: 'nowrap',
					}}
				>
					{p.name}
				</div>
			) : null}
		</AbsoluteFill>
	);
};

export const gather = defineLook({
	id: 'gather',
	category: 'diagram',
	kind: 'overlay',
	duration: 4,
	font: {weight: 700},
	usesFont2: false,
	weights: [700],
	description:
		'Scattered cards (emoji + label) appear one by one around the frame (soft rise, no bounce) and float gently; at `gatherAt` they all glide into one point with motion blur and shrink away while the logo grows out of that point with a soft ring: "it was all over the place, now it is in one app".',
	props,
	render: Gather,
});
