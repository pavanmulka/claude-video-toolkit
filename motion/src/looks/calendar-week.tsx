import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {z} from 'zod';
import {ease, map, prog, sp} from '../lib/anim';
import {liftShadow, mix, onColor, rgba} from '../lib/color';
import {fontCss} from '../lib/fonts';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {doc, int, num, str, strList} from '../lib/schema';
import {glass} from '../lib/ui';

const eventSchema = z.object({
	day: int(0, 'Day column 0-6 (0 = first day)', 0, 6),
	start: num(9, 'Start hour (decimal, e.g. 9.5 = 9:30)', 0, 24),
	end: num(10, 'End hour (decimal)', 0, 24),
	title: str('Event', 'Event title'),
	color: str('', 'Block colour (hex); empty = cycles accent / accent2 / glow'),
});

const props = {
	title: str('September', 'Panel title (e.g. month)'),
	subtitle: str('Sep 22 – 28', 'Subtitle (e.g. week range)'),
	days: strList(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], '7 day labels'),
	startDate: int(22, 'Date number of the first day (0 = hide date numbers)', 0, 31),
	today: int(1, 'Highlighted day index (-1 = none)', -1, 6),
	startHour: num(8, 'First hour shown', 0, 23),
	endHour: num(18, 'Last hour shown', 1, 24),
	now: num(11.4, 'Hour of the "now" line on today (-1 = none)', -1, 24),
	events: doc(
		z.array(eventSchema).default([
			{day: 0, start: 9, end: 10.5, title: 'Flight · LIS', color: ''},
			{day: 1, start: 13, end: 14.5, title: 'Hotel check-in', color: ''},
			{day: 2, start: 10, end: 12, title: 'Museum tour', color: ''},
			{day: 3, start: 15, end: 16.5, title: 'Car pickup', color: ''},
			{day: 4, start: 11, end: 12, title: 'Team call', color: ''},
			{day: 5, start: 9.5, end: 11, title: 'Beach day', color: ''},
		]),
		'Event blocks that drop into their day: [{day, start, end, title, color?}]',
	),
	stagger: num(0.3, 'Seconds between event drops', 0.02, 5),
	panelWidth: num(0.94, 'Panel width as a fraction of the frame width (portrait)', 0.3, 1),
	panelHeight: num(0.62, 'Panel height as a fraction of the frame height (portrait)', 0.2, 1),
	y: num(0.5, 'Vertical centre (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const hourLabel = (h: number) => {
	const hh = Math.floor(h) % 24;
	const ap = hh < 12 ? 'a' : 'p';
	const d = hh % 12 === 0 ? 12 : hh % 12;
	return `${d}${ap}`;
};
const timeLabel = (h: number) => {
	const hh = Math.floor(h);
	const mm = Math.round((h - hh) * 60);
	const d = hh % 12 === 0 ? 12 : hh % 12;
	return `${d}:${String(mm).padStart(2, '0')}`;
};

const CalendarWeek: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, landscape, Ds} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const panelW = landscape ? Math.min(W * 0.7, 1500 * u) : W * p.panelWidth;
	const panelH = landscape ? H * 0.86 : H * p.panelHeight;
	const inS = sp(frame, fps, 0.03, {damping: 17, stiffness: 150});
	const pad = 30 * u;
	const headerH = 150 * u;
	const dayRowH = 92 * u;
	const gutter = 64 * u;
	const colW = (panelW - pad * 2 - gutter) / 7;
	const gridH = panelH - pad * 2 - headerH - dayRowH;
	const h0 = p.startHour;
	const h1 = Math.max(p.startHour + 1, p.endHour);
	const yOf = (h: number) => ((h - h0) / (h1 - h0)) * gridH;
	const palette = [theme.accent, theme.accent2, theme.glow];
	const drift = map(t, [0, Ds], [0, 1]);
	const ev0 = 0.55;
	return (
		<AbsoluteFill>
			<div
				style={{
					position: 'absolute',
					left: W / 2,
					top: p.y * H,
					width: panelW,
					height: panelH,
					transform: `translate(-50%, -50%) translateY(${(1 - inS) * 80 * u}px) scale(${(0.94 + 0.06 * inS) * (1 + 0.015 * drift)})`,
					opacity: Math.min(1, inS * 1.5),
					...glass(u, theme, 'dark', 46),
					boxSizing: 'border-box',
					padding: pad,
					overflow: 'hidden',
				}}
			>
				{/* header */}
				<div style={{height: headerH, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingLeft: 8 * u}}>
					<div style={{...fontCss(font, {weight: 800}), fontSize: 64 * u, letterSpacing: '-0.02em', color: theme.fg, textShadow: liftShadow(u, 0.3)}}>{p.title}</div>
					<div style={{...fontCss(font, {weight: 600}), fontSize: 32 * u, color: theme.muted, marginTop: 4 * u}}>{p.subtitle}</div>
				</div>
				{/* day header */}
				<div style={{display: 'flex', height: dayRowH, paddingLeft: gutter}}>
					{p.days.slice(0, 7).map((d, i) => {
						const isToday = i === p.today;
						const e = ease.outCubic(prog(t, 0.15 + i * 0.03, 0.55 + i * 0.03));
						return (
							<div key={i} style={{width: colW, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 * u, opacity: e, transform: `translateY(${(1 - e) * 16 * u}px)`}}>
								<div style={{...fontCss(font, {weight: 700}), fontSize: 24 * u, color: isToday ? theme.accent : theme.muted, textTransform: 'uppercase', letterSpacing: '0.06em'}}>{d}</div>
								{p.startDate > 0 ? (
									<div
										style={{
											...fontCss(font, {weight: 700}),
											fontSize: 34 * u,
											width: 54 * u,
											height: 54 * u,
											borderRadius: '50%',
											display: 'flex',
											alignItems: 'center',
											justifyContent: 'center',
											color: isToday ? onColor(theme.accent) : theme.fg,
											background: isToday ? theme.accent : 'transparent',
											boxShadow: isToday ? `0 0 ${20 * u}px ${rgba(theme.accent, 0.5)}` : undefined,
										}}
									>
										{p.startDate + i}
									</div>
								) : null}
							</div>
						);
					})}
				</div>
				{/* grid */}
				<div style={{position: 'relative', height: gridH}}>
					{p.today >= 0 ? <div style={{position: 'absolute', left: gutter + p.today * colW, width: colW, top: 0, bottom: 0, background: rgba(theme.accent, 0.06), borderRadius: 16 * u}} /> : null}
					{Array.from({length: Math.floor(h1 - h0) + 1}, (_, k) => h0 + k).map((h) => (
						<React.Fragment key={h}>
							<div style={{position: 'absolute', left: gutter, right: 0, top: yOf(h), height: 1.5 * u, background: rgba('#FFFFFF', 0.08)}} />
							{(h - h0) % 2 === 0 ? (
								<div style={{position: 'absolute', left: 0, width: gutter - 12 * u, top: yOf(h) - 13 * u, textAlign: 'right', ...fontCss(font, {weight: 600}), fontSize: 21 * u, color: theme.muted}}>{hourLabel(h)}</div>
							) : null}
						</React.Fragment>
					))}
					{Array.from({length: 8}, (_, k) => (
						<div key={k} style={{position: 'absolute', top: 0, bottom: 0, left: gutter + k * colW, width: 1.5 * u, background: rgba('#FFFFFF', 0.06)}} />
					))}
					{p.events.map((ev, i) => {
						const t0 = ev0 + i * p.stagger;
						if (t < t0) return null;
						const s = sp(frame, fps, t0, {damping: 11, stiffness: 190, mass: 0.8});
						const c = ev.color || palette[i % palette.length];
						const top = yOf(Math.max(h0, ev.start));
						const hgt = Math.max(30 * u, yOf(Math.min(h1, ev.end)) - top);
						const land = Math.max(0, s - 1);
						return (
							<div
								key={i}
								style={{
									position: 'absolute',
									left: gutter + ev.day * colW + 4 * u,
									width: colW - 8 * u,
									top,
									height: hgt,
									boxSizing: 'border-box',
									borderRadius: 14 * u,
									padding: `${8 * u}px ${8 * u}px ${8 * u}px ${14 * u}px`,
									background: `linear-gradient(180deg, ${rgba(c, 0.42)}, ${rgba(c, 0.26)})`,
									border: `${1.5 * u}px solid ${rgba(c, 0.55)}`,
									boxShadow: `0 ${10 * u}px ${24 * u}px rgba(0,0,0,0.35), 0 0 ${24 * u}px ${rgba(c, 0.25)}`,
									overflow: 'hidden',
									opacity: Math.min(1, s * 2),
									transform: `translateY(${(1 - Math.min(1, s)) * -140 * u}px) scaleY(${1 - land * 0.6})`,
									transformOrigin: 'bottom center',
								}}
							>
								<div style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: 6 * u, background: c}} />
								<div style={{...fontCss(font, {weight: 700}), fontSize: 19 * u, lineHeight: 1.15, color: theme.fg, overflowWrap: 'break-word'}}>{ev.title}</div>
								<div style={{...fontCss(font, {weight: 600}), fontSize: 18 * u, color: rgba(theme.fg, 0.7), marginTop: 2 * u}}>{timeLabel(ev.start)}</div>
							</div>
						);
					})}
					{p.today >= 0 && p.now >= h0 && p.now <= h1 ? (
						<div style={{position: 'absolute', left: gutter + p.today * colW - 6 * u, width: colW + 6 * u, top: yOf(p.now) - 1.5 * u, height: 3 * u, background: '#FF5A6E', opacity: prog(t, 0.4, 0.8), boxShadow: `0 0 ${10 * u}px rgba(255,90,110,0.8)`}}>
							<div style={{position: 'absolute', left: -6 * u, top: -6 * u, width: 15 * u, height: 15 * u, borderRadius: '50%', background: '#FF5A6E'}} />
						</div>
					) : null}
				</div>
				<div style={{position: 'absolute', inset: 0, pointerEvents: 'none', background: `radial-gradient(90% 50% at 10% 0%, ${rgba(mix(theme.accent2, '#FFFFFF', 0.3), 0.1)}, transparent 60%)`}} />
			</div>
		</AbsoluteFill>
	);
};

export const calendarWeek = defineLook({
	id: 'calendar-week',
	category: 'ui',
	kind: 'overlay',
	duration: 4.5,
	description: 'Frosted weekly calendar panel (title, day header with today highlighted, hour grid, red "now" line) where event blocks drop into their day one by one with a bouncy landing.',
	usesFont2: false,
	weights: [600, 700, 800],
	props,
	render: CalendarWeek,
});
