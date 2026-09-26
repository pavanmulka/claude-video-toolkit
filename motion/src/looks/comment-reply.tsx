import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {lerp, map, sp} from '../lib/anim';
import {rgba} from '../lib/color';
import {fontCss} from '../lib/fonts';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {asset, color, num, str} from '../lib/schema';
import {Avatar} from '../lib/ui';

const props = {
	username: str('weekend.traveler', 'Commenter username (without @)'),
	text: str('How do you keep track of all your bookings??', 'The comment being replied to'),
	avatar: asset('Commenter avatar; empty = initials'),
	label: str('Replying to', 'Header text before @username'),
	cardColor: color('#FFFFFF', 'Card colour'),
	inkColor: color('#16121C', 'Comment text colour'),
	size: num(44, 'Comment text size (design units)', 10, 120),
	maxWidth: num(0.8, 'Max card width as a fraction of the frame width', 0.3, 1),
	tilt: num(-2, 'Resting tilt in degrees', -20, 20),
	x: num(0.5, 'Horizontal centre (fraction of width)', 0, 1),
	y: num(0.3, 'Vertical centre (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const CommentReply: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, Ds} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const fs = p.size * u;
	const s = sp(frame, fps, 0.06, {damping: 10, stiffness: 180, mass: 0.8});
	const settle = map(t, [0.5, 1.2], [0, 1]);
	const float = Math.sin(t * 1.7) * 5 * u * settle;
	const wob = Math.sin(t * 1.3 + 0.8) * 0.5 * settle;
	const rot = lerp(p.tilt - 9, p.tilt, s) + wob;
	const drift = map(t, [0, Ds], [0, 1]);
	const muted = rgba(p.inkColor, 0.5);
	return (
		<AbsoluteFill>
			<div
				style={{
					position: 'absolute',
					left: p.x * W,
					top: p.y * H,
					width: 'max-content',
					maxWidth: W * p.maxWidth,
					transform: `translate(-50%, -50%) translateY(${float}px) rotate(${rot}deg) scale(${Math.max(0, s) * (1 + 0.015 * drift)})`,
					transformOrigin: '20% 100%',
					opacity: Math.min(1, s * 2),
				}}
			>
				<div
					style={{
						position: 'relative',
						display: 'flex',
						gap: fs * 0.55,
						alignItems: 'flex-start',
						padding: `${fs * 0.62}px ${fs * 0.8}px ${fs * 0.7}px ${fs * 0.62}px`,
						borderRadius: fs * 0.75,
						background: p.cardColor,
						boxShadow: `0 ${18 * u}px ${46 * u}px rgba(0,0,0,0.35), 0 ${3 * u}px ${8 * u}px rgba(0,0,0,0.18)`,
					}}
				>
					<Avatar src={p.avatar} name={p.username.replace(/^@/, '')} size={fs * 1.8} theme={theme} font={font} />
					<div style={{minWidth: 0}}>
						<div style={{display: 'flex', alignItems: 'center', gap: fs * 0.22, ...fontCss(font, {weight: 600}), fontSize: fs * 0.66, color: muted, whiteSpace: 'nowrap'}}>
							<svg width={fs * 0.62} height={fs * 0.62} viewBox="0 0 24 24">
								<path d="M10 5 L3.5 11.5 L10 18 M4 11.5 H14 C18 11.5 20.5 14 20.5 19" fill="none" stroke={theme.accent2} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
							<span>
								{p.label} <span style={{color: rgba(p.inkColor, 0.85), fontWeight: 800}}>@{p.username.replace(/^@/, '')}</span>
							</span>
						</div>
						<div style={{...fontCss(font, {weight: 700}), fontSize: fs, lineHeight: 1.22, color: p.inkColor, marginTop: fs * 0.18, letterSpacing: '-0.01em', maxWidth: W * p.maxWidth - fs * 4.2, textWrap: 'pretty'} as React.CSSProperties}>
							{p.text}
						</div>
					</div>
					{/* speech tail */}
					<svg width={fs * 1.1} height={fs * 0.8} viewBox="0 0 30 22" style={{position: 'absolute', left: fs * 1.3, bottom: -fs * 0.62}}>
						<path d="M0 0 H30 C 22 4 14 12 6 22 C 7 12 5 5 0 0 Z" fill={p.cardColor} />
					</svg>
				</div>
			</div>
		</AbsoluteFill>
	);
};

export const commentReply = defineLook({
	id: 'comment-reply',
	category: 'ui',
	kind: 'overlay',
	duration: 3,
	description: '"Replying to @username" comment sticker: white card with avatar, reply arrow, @username and the comment text pops in with a bouncy spring and tilt, then gently floats. Generic styling (not a platform imitation).',
	usesFont2: false,
	weights: [600, 700, 800],
	props,
	render: CommentReply,
});
