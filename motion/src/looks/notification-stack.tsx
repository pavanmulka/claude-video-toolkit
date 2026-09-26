import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {z} from 'zod';
import {ease, prog, sp} from '../lib/anim';
import {liftShadow, rgba} from '../lib/color';
import {fontCss} from '../lib/fonts';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {asset, bool, doc, num, oneOf, str} from '../lib/schema';
import {AppIcon, glass} from '../lib/ui';

const noteSchema = z.object({
	app: str('App', 'App name (small caps header)'),
	title: str('', 'Bold title line'),
	body: str('', 'Body text (2 lines max)'),
	time: str('now', 'Time label, e.g. "now", "5m ago"'),
	icon: asset('App icon image or a single emoji; empty = letter tile'),
});

const props = {
	notifications: doc(
		z.array(noteSchema).default([
			{app: 'Calendar', title: 'Check in for your flight', body: 'Online check-in is open · LIS 9:40 AM', time: '9:12 AM', icon: '✈️'},
			{app: 'Messages', title: 'Alex', body: 'Did you book the hotel? Prices go up tonight', time: '9:30 AM', icon: '💬'},
			{app: 'Your App', title: 'Lisbon · Flight tomorrow', body: 'Tue 9:40 AM · boarding pass and hotel attached', time: 'now', icon: ''},
		]),
		'Notifications in arrival order (newest lands on top): [{app, title, body, time, icon}]',
	),
	clock: bool(true, 'Big lock-screen clock and date above the stack'),
	time: str('8:30', 'Clock text'),
	date: str('Tuesday, September 23', 'Date line above the clock'),
	stagger: num(0.75, 'Seconds between notifications', 0.1, 10),
	start: num(0.5, 'Seconds until the first notification', 0, 30),
	glassTone: oneOf(['dark', 'light'] as const, 'dark', 'Card style: dark glass or light frosted'),
	size: num(34, 'Body text size (design units)', 10, 100),
	cardWidth: num(0.92, 'Card width as a fraction of the frame width (portrait)', 0.3, 1),
	y: num(0.2, 'Top of the clock (or first card) as a fraction of the frame height', 0, 1),
};

type P = LookProps<typeof props>;

const NotificationStack: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, landscape} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const fs = p.size * u;
	const cardW = landscape ? Math.min(W * 0.46, 900 * u) : Math.min(W * p.cardWidth, 1000 * u);
	const cardH = fs * 6.1;
	const gap = 18 * u;
	const light = p.glassTone === 'light';
	const ink = light ? '#15121C' : theme.fg;
	const sub = light ? 'rgba(21,18,28,0.55)' : rgba(theme.fg, 0.6);
	const clockIn = ease.outExpo(prog(t, 0.02, 0.9));
	const clockH = p.clock ? 330 * u : 0;
	const top = p.y * H;
	const arrivals = p.notifications.map((_, i) => p.start + i * p.stagger);
	const scale = Math.min(1, (H * 0.96 - top) / (clockH + Math.min(4, p.notifications.length) * (cardH + gap) + 20 * u));
	return (
		<AbsoluteFill>
			<div style={{position: 'absolute', left: W / 2, top, width: cardW, transform: `translateX(-50%) scale(${scale})`, transformOrigin: 'top center'}}>
				{p.clock ? (
					<div style={{position: 'absolute', left: 0, right: 0, top: 0, textAlign: 'center', opacity: clockIn, transform: `translateY(${(1 - clockIn) * -30 * u}px)`}}>
						<div style={{...fontCss(font, {weight: 600}), fontSize: 44 * u, color: rgba('#FFFFFF', 0.9), textShadow: liftShadow(u, 0.35)}}>{p.date}</div>
						<div style={{...fontCss(font, {weight: 700}), fontSize: 220 * u, lineHeight: 1, letterSpacing: '-0.03em', color: '#FFFFFF', textShadow: `${liftShadow(u, 0.3)}, 0 0 ${60 * u}px ${rgba(theme.glow, 0.35)}`}}>{p.time}</div>
					</div>
				) : null}
				{p.notifications.map((n, i) => {
					const t0 = arrivals[i];
					if (t < t0) return null;
					const s = sp(frame, fps, t0, {damping: 15, stiffness: 190, mass: 0.9});
					// pushed down by every newer card
					let push = 0;
					let depth = 0;
					for (let j = i + 1; j < arrivals.length; j++) {
						if (t >= arrivals[j]) {
							const sj = sp(frame, fps, arrivals[j], {damping: 16, stiffness: 180, mass: 0.9});
							push += sj;
							depth += sj;
						}
					}
					const slot = Math.min(push, 2) + Math.max(0, push - 2) * 0.12;
					const y = (clockH ? clockH - 60 * u : 0) + slot * (cardH + gap);
					const collapse = Math.max(0, depth - 2);
					const flash = Math.exp(-Math.max(0, t - t0 - 0.2) / 0.5);
					return (
						<div
							key={i}
							style={{
								position: 'absolute',
								left: 0,
								top: y,
								width: cardW,
								height: cardH,
								zIndex: 100 - Math.round(push * 10),
								opacity: Math.min(1, s * 1.5) * (1 - 0.35 * Math.min(1, collapse)),
								transform: `translateY(${(1 - s) * -cardH * 0.9}px) scale(${(0.9 + 0.1 * s) * (1 - 0.05 * collapse)})`,
								transformOrigin: 'top center',
							}}
						>
							<div
								style={{
									...glass(u, theme, p.glassTone, 38),
									height: '100%',
									boxSizing: 'border-box',
									padding: `${fs * 0.75}px ${fs * 0.85}px`,
									display: 'flex',
									gap: fs * 0.7,
									alignItems: 'flex-start',
									boxShadow: `${glass(u, theme, p.glassTone).boxShadow}, 0 0 ${40 * u}px ${rgba(theme.accent, 0.35 * flash)}`,
									border: `${1.5 * u}px solid ${flash > 0.05 ? rgba(theme.accent, 0.25 + 0.5 * flash) : light ? rgba('#FFFFFF', 0.7) : rgba('#FFFFFF', 0.14)}`,
								}}
							>
								<AppIcon src={n.icon} label={n.app} size={fs * 2.4} theme={theme} font={font} />
								<div style={{flex: 1, minWidth: 0}}>
									<div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', ...fontCss(font, {weight: 700}), fontSize: fs * 0.78, color: sub, letterSpacing: '0.04em', textTransform: 'uppercase'}}>
										<span>{n.app}</span>
										<span style={{textTransform: 'none', letterSpacing: 0, fontWeight: 600}}>{n.time}</span>
									</div>
									<div style={{...fontCss(font, {weight: 700}), fontSize: fs * 1.06, color: ink, marginTop: fs * 0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{n.title}</div>
									<div
										style={{
											...fontCss(font, {weight: 500}),
											fontSize: fs,
											lineHeight: 1.28,
											color: light ? 'rgba(21,18,28,0.82)' : rgba(theme.fg, 0.85),
											marginTop: fs * 0.08,
											display: '-webkit-box',
											WebkitLineClamp: 2,
											WebkitBoxOrient: 'vertical',
											overflow: 'hidden',
										}}
									>
										{n.body}
									</div>
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</AbsoluteFill>
	);
};

export const notificationStack = defineLook({
	id: 'notification-stack',
	category: 'ui',
	kind: 'overlay',
	duration: 4.5,
	description: 'Lock-screen style: optional big clock + date, then notification cards (icon, app, time, title, 2-line body) drop in from above on springs; the newest lands on top and pushes older ones down (they collapse into a pile after three). Dark or light glass.',
	usesFont2: false,
	weights: [500, 600, 700],
	props,
	render: NotificationStack,
});
