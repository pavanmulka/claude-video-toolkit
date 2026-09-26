import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {z} from 'zod';
import {ease, lerp, prog, sp} from '../lib/anim';
import {mix, onColor, rgba} from '../lib/color';
import {fontCss} from '../lib/fonts';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {asset, bool, doc, num, oneOf, str} from '../lib/schema';
import {Avatar, GrowRow, Tail, TypingDots} from '../lib/ui';

const msgSchema = z.object({
	from: oneOf(['them', 'me'] as const, 'them', 'Who sends it: them (left) or me (right)'),
	text: str('', 'Message text (emoji welcome)'),
	name: str('', 'Sender name shown above their bubble (them)'),
	avatar: asset('Sender avatar (them); empty = initials'),
	at: num(-1, 'Seconds when the message appears (-1 = automatic timing)', -1, 600),
});

const props = {
	messages: doc(
		z.array(msgSchema).default([
			{from: 'them', text: 'Do you have the booking number? The hotel needs it 😅', name: 'Alex', avatar: '', at: -1},
			{from: 'me', text: 'One sec…', name: '', avatar: '', at: -1},
			{from: 'me', text: 'Sent! It’s all in the app 💜', name: '', avatar: '', at: -1},
			{from: 'them', text: 'You’re a lifesaver ❤️', name: 'Alex', avatar: '', at: -1},
		]),
		'Messages in order: [{from: them|me, text, name?, avatar?, at?}]',
	),
	header: str('', 'Optional contact name shown as a chat header at the top (empty = none)'),
	headerAvatar: asset('Header avatar image'),
	typing: bool(true, 'Typing indicator before "them" messages'),
	typingDuration: num(0.85, 'Seconds of typing dots before each "them" message', 0, 10),
	gap: num(0.55, 'Pause after each message (automatic timing)', 0, 10),
	size: num(52, 'Message text size (design units)', 10, 120),
	columnWidth: num(0.88, 'Chat column width as a fraction of the frame width (portrait)', 0.3, 1),
	areaHeight: num(0.6, 'Max chat area height as a fraction of the frame height (the thread grows from the centre, then scrolls)', 0.1, 1),
	meColor: str('', 'My bubble colour (empty = theme.accent)'),
	themColor: str('', 'Their bubble colour (empty = a lifted theme.bg)'),
	delivered: bool(true, '"Delivered" under my last message'),
	y: num(0.47, 'Vertical centre of the chat area (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

type Timed = z.infer<typeof msgSchema> & {appear: number; typingStart: number; index: number};

const ChatBubbles: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, landscape} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const me = p.meColor || theme.accent;
	const them = p.themColor || mix(theme.bg, '#FFFFFF', 0.17);
	const meInk = onColor(me);
	const themInk = onColor(them);
	const timed = useMemo<Timed[]>(() => {
		let cursor = 0.25;
		return p.messages.map((m, index) => {
			const typingOn = p.typing && m.from === 'them';
			let appear: number;
			let typingStart: number;
			if (m.at >= 0) {
				appear = m.at;
				typingStart = typingOn ? Math.max(0, m.at - p.typingDuration) : m.at;
			} else {
				typingStart = cursor;
				appear = cursor + (typingOn ? p.typingDuration : 0);
			}
			cursor = appear + p.gap + Math.min(0.7, m.text.length * 0.012);
			return {...m, appear, typingStart, index};
		});
	}, [p.messages, p.typing, p.typingDuration, p.gap]);
	const lastMe = [...timed].reverse().find((m) => m.from === 'me');
	const colW = landscape ? Math.min(W * 0.55, 1000 * u) : W * p.columnWidth;
	const areaH = H * p.areaHeight;
	const fs = p.size * u;
	const bubbleStyle = (mine: boolean): React.CSSProperties => ({
		...fontCss(font, {weight: 600}),
		fontSize: fs,
		lineHeight: 1.28,
		padding: `${fs * 0.46}px ${fs * 0.7}px`,
		borderRadius: fs * 1.05,
		background: mine ? me : them,
		color: mine ? meInk : themInk,
		boxShadow: `0 ${6 * u}px ${18 * u}px rgba(0,0,0,0.28)`,
		letterSpacing: '-0.005em',
		overflowWrap: 'anywhere',
	});
	const rows: React.ReactNode[] = [];
	timed.forEach((m, i) => {
		const mine = m.from === 'me';
		const next = timed[i + 1];
		const prev = timed[i - 1];
		const lastInGroup = !next || next.from !== m.from;
		const firstInGroup = !prev || prev.from !== m.from;
		// typing row
		if (!mine && p.typing && m.appear > m.typingStart) {
			const tin = sp(frame, fps, m.typingStart, {damping: 16, stiffness: 200});
			const tout = prog(t, m.appear - 0.02, m.appear + 0.14, ease.inOutCubic);
			const g = t < m.typingStart ? 0 : Math.max(0, tin - tout);
			if (g > 0.001) {
				rows.push(
					<GrowRow key={`ty${i}`} p={g}>
						<div style={{display: 'flex', alignItems: 'flex-end', gap: 14 * u, paddingTop: 10 * u}}>
							<div style={{opacity: g}}>
								<Avatar src={m.avatar} name={m.name || 'Them'} size={fs * 1.45} theme={theme} font={font} />
							</div>
							<div style={{position: 'relative', transformOrigin: 'bottom left', transform: `scale(${0.25 + 0.75 * g})`, opacity: g}}>
								<div style={{...bubbleStyle(false), padding: `${fs * 0.5}px ${fs * 0.62}px`}}>
									<TypingDots t={t} size={fs * 0.32} color={rgba(themInk, 0.8)} />
								</div>
								<Tail side="left" color={them} size={fs * 0.62} />
							</div>
						</div>
					</GrowRow>,
				);
			}
		}
		if (t < m.appear) return;
		const s = sp(frame, fps, m.appear, {damping: 14, stiffness: 210, mass: 0.8});
		const deliveredOn = p.delivered && lastMe && lastMe.index === m.index ? ease.outCubic(prog(t, m.appear + 0.45, m.appear + 0.8)) : 0;
		rows.push(
			<GrowRow key={`m${i}`} p={s}>
				<div style={{paddingTop: (firstInGroup ? 18 : 6) * u}}>
					{!mine && firstInGroup && m.name ? (
						<div style={{...fontCss(font, {weight: 600}), fontSize: fs * 0.6, color: theme.muted, marginLeft: fs * 1.45 + 14 * u + fs * 0.4, marginBottom: 6 * u, opacity: Math.min(1, s)}}>{m.name}</div>
					) : null}
					<div style={{display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 14 * u}}>
						{!mine ? (
							<div style={{width: fs * 1.45, flexShrink: 0, opacity: lastInGroup ? Math.min(1, s) : 0}}>
								<Avatar src={m.avatar} name={m.name || 'Them'} size={fs * 1.45} theme={theme} font={font} />
							</div>
						) : null}
						<div
							style={{
								position: 'relative',
								maxWidth: '76%',
								transformOrigin: mine ? 'bottom right' : 'bottom left',
								transform: `translateY(${(1 - Math.min(1, s)) * (mine ? 20 : 8) * u}px) scale(${lerp(0.25, 1, s)})`,
								opacity: Math.min(1, s * 1.6),
							}}
						>
							<div
								style={{
									...bubbleStyle(mine),
									borderBottomLeftRadius: !mine && lastInGroup ? fs * 0.35 : fs * 1.05,
									borderBottomRightRadius: mine && lastInGroup ? fs * 0.35 : fs * 1.05,
								}}
							>
								{m.text}
							</div>
							{lastInGroup ? <Tail side={mine ? 'right' : 'left'} color={mine ? me : them} size={fs * 0.62} /> : null}
						</div>
					</div>
					{mine && p.delivered && lastMe?.index === m.index ? (
						<div style={{...fontCss(font, {weight: 600}), fontSize: fs * 0.52, color: theme.muted, textAlign: 'right', marginTop: 6 * u, marginRight: 6 * u, opacity: deliveredOn}}>
							Delivered
						</div>
					) : null}
				</div>
			</GrowRow>,
		);
	});
	const headerIn = sp(frame, fps, 0.02, {damping: 18, stiffness: 150});
	return (
		<AbsoluteFill>
			<div
				style={{
					position: 'absolute',
					left: (W - colW) / 2,
					width: colW,
					top: p.y * H,
					maxHeight: areaH,
					transform: 'translateY(-50%)',
					display: 'flex',
					flexDirection: 'column',
				}}
			>
				{p.header ? (
					<div
						style={{
							display: 'flex',
							flexDirection: 'column',
							alignItems: 'center',
							gap: 10 * u,
							paddingBottom: 18 * u,
							marginBottom: 6 * u,
							borderBottom: `${1.5 * u}px solid ${rgba('#FFFFFF', 0.12)}`,
							opacity: headerIn,
							transform: `translateY(${(1 - headerIn) * -20 * u}px)`,
						}}
					>
						<Avatar src={p.headerAvatar} name={p.header} size={96 * u} theme={theme} font={font} />
						<div style={{...fontCss(font, {weight: 700}), fontSize: 36 * u, color: theme.fg}}>{p.header}</div>
					</div>
				) : null}
				<div
					style={{
						flex: '1 1 auto',
						minHeight: 0,
						display: 'flex',
						flexDirection: 'column',
						justifyContent: 'flex-end',
						overflow: 'hidden',
						padding: `${50 * u}px ${fs * 0.4}px ${16 * u}px`,
						WebkitMaskImage: `linear-gradient(180deg, transparent 0px, #000 ${50 * u}px, #000 100%)`,
						maskImage: `linear-gradient(180deg, transparent 0px, #000 ${50 * u}px, #000 100%)`,
					}}
				>
					{rows}
				</div>
			</div>
		</AbsoluteFill>
	);
};

export const chatBubbles = defineLook({
	id: 'chat-bubbles',
	category: 'ui',
	kind: 'overlay',
	duration: 6,
	description: 'Messaging thread: bubbles spring in one by one (mine on the right in the accent colour, theirs on the left with avatar + name), typing dots before their messages, the thread scrolls up as it grows, "Delivered" under my last message. Generic styling from the theme.',
	usesFont2: false,
	weights: [600, 700, 800],
	props,
	render: ChatBubbles,
});
