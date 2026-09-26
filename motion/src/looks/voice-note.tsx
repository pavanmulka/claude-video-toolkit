import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {breathe, fmtTime, lerp, prog, rnd, sp} from '../lib/anim';
import {mix, onColor, rgba} from '../lib/color';
import {fontCss} from '../lib/fonts';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {asset, int, num, oneOf, str} from '../lib/schema';
import {Avatar, Tail} from '../lib/ui';

const props = {
	from: oneOf(['them', 'me'] as const, 'them', 'Who sent the voice note'),
	name: str('Alex', 'Sender name (them)'),
	avatar: asset('Sender avatar; empty = initials'),
	noteLength: num(14, 'Displayed length of the voice note in seconds', 1, 3600),
	transcript: str('Can you find the hotel’s number? I think it was in that email…', 'Transcript under the waveform (empty = none); words light up as it plays'),
	reply: str('Found it, sending now 👍', 'Reply bubble that types in afterwards (empty = none)'),
	playAt: num(0.7, 'Seconds until playback starts', 0, 60),
	playDuration: num(2.6, 'Seconds the visible playback takes', 0.2, 60),
	bars: int(38, 'Waveform bars', 8, 120),
	size: num(50, 'Text size (design units)', 10, 120),
	columnWidth: num(0.88, 'Column width as a fraction of the frame width', 0.3, 1),
	y: num(0.5, 'Vertical centre (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const VoiceNote: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, landscape} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const fs = p.size * u;
	const mineNote = p.from === 'me';
	const noteColor = mineNote ? theme.accent : mix(theme.bg, '#FFFFFF', 0.17);
	const noteInk = onColor(noteColor);
	const replyColor = mineNote ? mix(theme.bg, '#FFFFFF', 0.17) : theme.accent;
	const replyInk = onColor(replyColor);
	const colW = landscape ? Math.min(W * 0.55, 1000 * u) : W * p.columnWidth;
	const heights = useMemo(
		() =>
			Array.from({length: p.bars}, (_, k) => {
				const env = 0.35 + 0.65 * Math.abs(Math.sin(k * 0.37 + 0.6) * Math.sin(k * 0.13 + 1.1));
				return Math.max(0.14, Math.min(1, env * rnd(`wv${k}`, 0.45, 1.15)));
			}),
		[p.bars],
	);
	const inS = sp(frame, fps, 0.08, {damping: 14, stiffness: 190, mass: 0.8});
	const q = prog(t, p.playAt, p.playAt + p.playDuration);
	const playing = q > 0 && q < 1;
	const words = p.transcript.split(/\s+/).filter(Boolean);
	const replyStart = p.playAt + p.playDuration + 0.45;
	const replyIn = p.reply ? sp(frame, fps, replyStart, {damping: 14, stiffness: 200, mass: 0.8}) : 0;
	const replyChars = Array.from(p.reply);
	const typedN = Math.floor(prog(t, replyStart + 0.2, replyStart + 0.2 + replyChars.length / 28) * replyChars.length);
	const btn = fs * 2.1;
	const barW = Math.max(3, fs * 0.13);
	const waveH = fs * 1.3;
	const blockH = fs * 7 + (p.transcript ? fs * 3 : 0) + (p.reply ? fs * 3 : 0);
	const scale = Math.min(1, (H * 0.9) / blockH);
	return (
		<AbsoluteFill>
			<div style={{position: 'absolute', left: (W - colW) / 2, width: colW, top: p.y * H, transform: `translateY(-50%) scale(${scale})`, display: 'flex', flexDirection: 'column', gap: 26 * u}}>
				{/* voice note */}
				<div style={{display: 'flex', flexDirection: 'column', alignItems: mineNote ? 'flex-end' : 'flex-start'}}>
					{!mineNote && p.name ? (
						<div style={{...fontCss(font, {weight: 600}), fontSize: fs * 0.6, color: theme.muted, marginLeft: fs * 1.45 + 14 * u + fs * 0.4, marginBottom: 8 * u, opacity: Math.min(1, inS)}}>{p.name}</div>
					) : null}
					<div style={{display: 'flex', alignItems: 'flex-end', gap: 14 * u, flexDirection: mineNote ? 'row-reverse' : 'row', width: '100%', justifyContent: 'flex-start'}}>
						{!mineNote ? <Avatar src={p.avatar} name={p.name || 'Them'} size={fs * 1.45} theme={theme} font={font} /> : null}
						<div
							style={{
								position: 'relative',
								maxWidth: '84%',
								transformOrigin: mineNote ? 'bottom right' : 'bottom left',
								transform: `translateY(${(1 - Math.min(1, inS)) * 30 * u}px) scale(${lerp(0.6, 1, inS)})`,
								opacity: Math.min(1, inS * 1.6),
							}}
						>
							<div
								style={{
									background: noteColor,
									color: noteInk,
									borderRadius: fs * 1.05,
									borderBottomLeftRadius: mineNote ? fs * 1.05 : fs * 0.35,
									borderBottomRightRadius: mineNote ? fs * 0.35 : fs * 1.05,
									padding: `${fs * 0.42}px ${fs * 0.62}px ${fs * 0.46}px ${fs * 0.42}px`,
									boxShadow: `0 ${8 * u}px ${24 * u}px rgba(0,0,0,0.3)`,
								}}
							>
								<div style={{display: 'flex', alignItems: 'center', gap: fs * 0.45}}>
									<div
										style={{
											width: btn,
											height: btn,
											borderRadius: '50%',
											flexShrink: 0,
											background: mineNote ? noteInk : theme.accent,
											display: 'flex',
											alignItems: 'center',
											justifyContent: 'center',
											boxShadow: playing ? `0 0 ${22 * u}px ${rgba(theme.accent, 0.55 + 0.25 * breathe(t, 0.8))}` : undefined,
											transform: `scale(${1 + 0.08 * Math.sin(Math.PI * prog(t, p.playAt - 0.12, p.playAt + 0.12))})`,
										}}
									>
										<svg width={btn * 0.42} height={btn * 0.42} viewBox="0 0 24 24">
											{playing ? (
												<g fill={mineNote ? noteColor : onColor(theme.accent)}>
													<rect x="5" y="4" width="4.6" height="16" rx="1.4" />
													<rect x="14.4" y="4" width="4.6" height="16" rx="1.4" />
												</g>
											) : (
												<path d="M7 4.5 L19.5 12 L7 19.5 Z" fill={mineNote ? noteColor : onColor(theme.accent)} strokeLinejoin="round" />
											)}
										</svg>
									</div>
									<div style={{display: 'flex', alignItems: 'center', gap: barW * 0.8, height: waveH}}>
										{heights.map((h, k) => {
											const pos = (k + 0.5) / heights.length;
											const played = pos <= q;
											const near = playing ? Math.exp(-Math.pow((pos - q) * heights.length * 0.35, 2)) : 0;
											const live = playing ? 1 + 0.25 * near * Math.sin(t * 22 + k) : 1;
											return (
												<div
													key={k}
													style={{
														width: barW,
														height: Math.max(barW, waveH * h * live),
														borderRadius: barW,
														background: played ? (mineNote ? noteInk : theme.accent) : rgba(noteInk, 0.38),
													}}
												/>
											);
										})}
									</div>
									<div style={{...fontCss(font, {weight: 700}), fontSize: fs * 0.72, fontVariantNumeric: 'tabular-nums', minWidth: fs * 1.9, textAlign: 'right', opacity: 0.85}}>
										{fmtTime(q > 0 ? q * p.noteLength : p.noteLength)}
									</div>
								</div>
								{p.transcript ? (
									<div style={{...fontCss(font, {weight: 500}), fontSize: fs * 0.72, lineHeight: 1.3, marginTop: fs * 0.35, marginLeft: fs * 0.15, maxWidth: colW * 0.72}}>
										{words.map((w, i) => {
											const lit = prog(q * words.length * 1.05, i - 0.2, i + 0.6);
											return (
												<span key={i} style={{opacity: 0.32 + 0.68 * lit}}>
													{i > 0 ? ' ' : ''}
													{w}
												</span>
											);
										})}
									</div>
								) : null}
							</div>
							<Tail side={mineNote ? 'right' : 'left'} color={noteColor} size={fs * 0.62} />
						</div>
					</div>
				</div>
				{/* reply */}
				{p.reply ? (
					<div style={{display: 'flex', justifyContent: mineNote ? 'flex-start' : 'flex-end', paddingLeft: mineNote ? fs * 1.45 + 14 * u : 0}}>
						<div
							style={{
								position: 'relative',
								maxWidth: '76%',
								transformOrigin: mineNote ? 'bottom left' : 'bottom right',
								transform: `translateY(${(1 - Math.min(1, replyIn)) * 40 * u}px) scale(${lerp(0.55, 1, replyIn)})`,
								opacity: Math.min(1, replyIn * 1.6),
							}}
						>
							<div
								style={{
									...fontCss(font, {weight: 600}),
									fontSize: fs,
									lineHeight: 1.28,
									padding: `${fs * 0.46}px ${fs * 0.7}px`,
									borderRadius: fs * 1.05,
									borderBottomRightRadius: mineNote ? fs * 1.05 : fs * 0.35,
									borderBottomLeftRadius: mineNote ? fs * 0.35 : fs * 1.05,
									background: replyColor,
									color: replyInk,
									boxShadow: `0 ${8 * u}px ${24 * u}px rgba(0,0,0,0.3)`,
									position: 'relative',
								}}
							>
								{/* full text keeps the bubble size stable; typed part visible */}
								<span style={{visibility: 'hidden'}}>{p.reply}</span>
								<span style={{position: 'absolute', left: fs * 0.7, top: fs * 0.46, right: fs * 0.7}}>
									{replyChars.slice(0, typedN).join('')}
									{typedN < replyChars.length && t > replyStart ? <span style={{display: 'inline-block', width: fs * 0.08, height: fs * 1.05, marginLeft: 2, verticalAlign: '-0.15em', background: replyInk, opacity: 0.7}} /> : null}
								</span>
							</div>
							<Tail side={mineNote ? 'left' : 'right'} color={replyColor} size={fs * 0.62} />
						</div>
					</div>
				) : null}
			</div>
		</AbsoluteFill>
	);
};

export const voiceNote = defineLook({
	id: 'voice-note',
	category: 'ui',
	kind: 'overlay',
	duration: 5.5,
	description: 'Voice-note bubble: play button flips to pause, waveform fills in the accent colour as it plays (bars near the playhead dance), elapsed time counts, transcript words light up in sync; then a reply bubble springs in and types itself.',
	usesFont2: false,
	weights: [500, 600, 700],
	props,
	render: VoiceNote,
});
