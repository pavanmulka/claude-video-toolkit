import {getLength} from '@remotion/paths';
import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {z} from 'zod';
import {breathe, ease, map, prog, sp} from '../lib/anim';
import {liftShadow, mix, rgba} from '../lib/color';
import {EMOJI_STACK, fontCss} from '../lib/fonts';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {Logo} from '../lib/logo';
import {asset, doc, num, str} from '../lib/schema';
import {glass} from '../lib/ui';

const itemSchema = z.object({
	label: str('Item', 'Source label'),
	icon: str('✨', 'Emoji (or leave empty)'),
});

const props = {
	items: doc(
		z.array(itemSchema).default([
			{label: 'Photos', icon: '📷'},
			{label: 'Emails', icon: '✉️'},
			{label: 'Notes', icon: '📝'},
			{label: 'Files', icon: '📁'},
		]),
		'Sources on the left: [{label, icon}] (2-6)',
	),
	hubLabel: str('Your App', 'Label under the hub'),
	hubLogo: asset('Hub logo image; empty = monogram'),
	speed: num(1, 'Pulse speed multiplier', 0, 10),
	itemSize: num(44, 'Item label size (design units)', 10, 120),
	hubSize: num(270, 'Hub size (design units)', 60, 700),
	y: num(0.5, 'Vertical centre (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const HubBeams: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, landscape, Ds} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const n = Math.max(1, p.items.length);
	const fs = p.itemSize * u;
	const itemH = fs * 2.3;
	const itemW = landscape ? Math.min(W * 0.26, 520 * u) : W * 0.4;
	const gapY = Math.min(itemH * 0.55, (H * 0.7 - n * itemH) / Math.max(1, n - 1));
	const totalH = n * itemH + (n - 1) * gapY;
	const cy = p.y * H;
	const ix = landscape ? W * 0.12 : W * 0.05;
	const hs = p.hubSize * u;
	const hx = landscape ? W * 0.66 : W * 0.75;
	const hubLeft = hx - hs / 2;
	const beams = useMemo(
		() =>
			p.items.map((_, i) => {
				const iy = cy - totalH / 2 + i * (itemH + gapY) + itemH / 2;
				const sx = ix + itemW;
				const ex = hubLeft;
				const ey = cy + (i - (n - 1) / 2) * hs * 0.12;
				const dx = ex - sx;
				const d = `M ${sx} ${iy} C ${sx + dx * 0.55} ${iy}, ${ex - dx * 0.45} ${ey}, ${ex} ${ey}`;
				return {d, L: getLength(d), iy};
			}),
		[p.items, cy, totalH, itemH, gapY, ix, itemW, hubLeft, n, hs],
	);
	const hubIn = sp(frame, fps, 0.35, {damping: 12, stiffness: 170, mass: 0.8});
	const period = 1.6 / Math.max(0.05, p.speed);
	const arrivals = beams.map((_, i) => {
		const start = 0.9 + i * 0.12;
		if (t < start + 0.5) return 0;
		const ph = ((t - start - 0.5) / period + i * 0.27) % 1;
		return Math.exp(-Math.pow((ph - 0.98) / 0.05, 2));
	});
	const hit = Math.min(1, arrivals.reduce((a, b) => a + b, 0));
	const rot = t * 70;
	const drift = map(t, [0, Ds], [0, 1]);
	return (
		<AbsoluteFill style={{transform: `scale(${1 + 0.015 * drift})`}}>
			<svg width={W} height={H} style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
				<defs>
					<linearGradient id="hbg" x1="0" x2="1" y1="0" y2="0">
						<stop offset="0%" stopColor={theme.accent2} />
						<stop offset="100%" stopColor={theme.accent} />
					</linearGradient>
					<filter id="hbblur" x="-10%" y="-50%" width="120%" height="200%">
						<feGaussianBlur stdDeviation={6 * u} />
					</filter>
				</defs>
				{beams.map((b, i) => {
					const s0 = 0.3 + i * 0.12;
					const draw = ease.inOutCubic(prog(t, s0, s0 + 0.7));
					const pulseLen = 120 * u;
					const start = 0.9 + i * 0.12;
					const ph = t > start ? ((t - start) / period + i * 0.27) % 1 : -1;
					const off = ph >= 0 ? b.L * (1 - ph) + pulseLen * ph : 0;
					return (
						<g key={i}>
							<path d={b.d} fill="none" stroke={rgba(theme.accent, 0.22)} strokeWidth={4 * u} strokeLinecap="round" strokeDasharray={b.L} strokeDashoffset={b.L * (1 - draw)} />
							{ph >= 0 ? (
								<>
									<path d={b.d} fill="none" stroke={theme.accent} strokeWidth={14 * u} strokeLinecap="round" strokeDasharray={`${pulseLen} ${b.L + pulseLen}`} strokeDashoffset={off} opacity={0.55} filter="url(#hbblur)" />
									<path d={b.d} fill="none" stroke={mix(theme.accent, '#FFFFFF', 0.4)} strokeWidth={5 * u} strokeLinecap="round" strokeDasharray={`${pulseLen} ${b.L + pulseLen}`} strokeDashoffset={off} />
								</>
							) : null}
						</g>
					);
				})}
			</svg>
			{p.items.map((it, i) => {
				const e = sp(frame, fps, 0.05 + i * 0.1, {damping: 15, stiffness: 170});
				const top = beams[i].iy - itemH / 2;
				return (
					<div
						key={i}
						style={{
							position: 'absolute',
							left: ix,
							top,
							width: itemW,
							height: itemH,
							boxSizing: 'border-box',
							...glass(u, theme, 'dark', 200),
							display: 'flex',
							alignItems: 'center',
							gap: fs * 0.45,
							padding: `0 ${fs * 0.5}px 0 ${fs * 0.28}px`,
							opacity: Math.min(1, e * 1.5),
							transform: `translateX(${(1 - e) * -80 * u}px)`,
							boxShadow: `${glass(u, theme).boxShadow}, 0 0 ${30 * u}px ${rgba(theme.accent, 0.35 * arrivals[i])}`,
						}}
					>
						<div style={{width: itemH * 0.78, height: itemH * 0.78, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: rgba('#FFFFFF', 0.14), fontFamily: EMOJI_STACK, fontSize: itemH * 0.46, lineHeight: 1}}>
							{it.icon}
						</div>
						<div style={{...fontCss(font, {weight: 700}), fontSize: fs, color: theme.fg, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{it.label}</div>
						<div style={{marginLeft: 'auto', width: 12 * u, height: 12 * u, borderRadius: '50%', background: theme.accent, boxShadow: `0 0 ${12 * u}px ${theme.accent}`, flexShrink: 0}} />
					</div>
				);
			})}
			{/* hub */}
			<div style={{position: 'absolute', left: hx, top: cy, transform: `translate(-50%, -50%) scale(${(0.6 + 0.4 * hubIn) * (1 + 0.04 * hit)})`, opacity: Math.min(1, hubIn * 1.5), display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 * u}}>
				<div style={{position: 'relative', width: hs, height: hs}}>
					<div style={{position: 'absolute', inset: -hs * 0.45, borderRadius: '50%', background: `radial-gradient(circle, ${rgba(theme.glow, 0.45 + 0.25 * hit + 0.1 * breathe(t, 2))} 0%, transparent 65%)`}} />
					<div style={{position: 'absolute', inset: 0, borderRadius: hs * 0.28, padding: 4 * u, background: `conic-gradient(from ${rot}deg, ${rgba(theme.accent, 0)} 0deg, ${theme.accent} 70deg, ${rgba(theme.accent2, 0)} 140deg, ${rgba(theme.accent2, 0)} 200deg, ${theme.accent2} 270deg, ${rgba(theme.accent, 0)} 340deg)`}}>
						<div style={{...glass(u, theme, 'dark', 0), width: '100%', height: '100%', boxSizing: 'border-box', borderRadius: hs * 0.26, background: `linear-gradient(160deg, ${mix(theme.bg, '#FFFFFF', 0.16)}, ${mix(theme.bg, '#000000', 0.1)})`, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
							<Logo src={p.hubLogo} name={p.hubLabel} size={hs * 0.56} shape="app" theme={theme} font={font} shadow={false} />
						</div>
					</div>
				</div>
				{p.hubLabel ? <div style={{...fontCss(font, {weight: 800}), fontSize: fs * 1.05, color: theme.fg, textShadow: liftShadow(u, 0.4)}}>{p.hubLabel}</div> : null}
			</div>
		</AbsoluteFill>
	);
};

export const hubBeams = defineLook({
	id: 'hub-beams',
	category: 'diagram',
	kind: 'overlay',
	duration: 4,
	description: 'Source pills (emoji + label) slide in on the left, curved beams draw into a central hub card (logo, rotating gradient border, breathing glow) and bright pulses keep flowing along the beams into it; the hub bumps as pulses arrive.',
	usesFont2: false,
	weights: [700, 800],
	props,
	render: HubBeams,
});
