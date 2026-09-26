import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {z} from 'zod';
import {breathe, ease, map, prog, rnd, sp} from '../lib/anim';
import {liftShadow, onColor, rgba} from '../lib/color';
import {sansStack} from '../lib/fonts';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {fitFontSize} from '../lib/measure';
import {parseRich} from '../lib/rich';
import {bool, doc, num, oneOf, str} from '../lib/schema';
import {Anchor} from '../lib/text';

const MONO_DEFAULT = {family: 'Space Mono', weight: 700};

const props = {
	text: str("Where's my **boarding pass?**", 'Text to type; **word** = highlighted after typing, \\n = line break'),
	mono: doc(
		z
			.object({
				family: str(MONO_DEFAULT.family, 'Typewriter font family (monospace looks most authentic; any brand family works)'),
				weight: num(MONO_DEFAULT.weight, 'Font weight', 100, 1000),
			})
			.default(MONO_DEFAULT),
		'Font used for the typed text (default Space Mono)',
	),
	size: num(76, 'Font size in design units (auto-shrinks to fit)', 12, 300),
	maxWidth: num(0.84, 'Max text width as a fraction of the frame width', 0.2, 1),
	cps: num(17, 'Typing speed in characters per second', 1, 200),
	start: num(0.35, 'Seconds of blinking caret before typing starts', 0, 10),
	caret: bool(true, 'Show the caret'),
	highlight: bool(true, 'Sweep an accent chip behind the **accent** words once typing is done'),
	align: oneOf(['left', 'center'] as const, 'left', 'Text alignment inside the block'),
	box: oneOf(['none', 'field'] as const, 'none', 'none = bare text; field = frosted input field with search icon and send button'),
	x: num(0.5, 'Horizontal centre (fraction of width)', 0, 1),
	y: num(0.5, 'Vertical centre (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const TextTypewriter: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, Ds} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const rich = useMemo(() => parseRich(p.text), [p.text]);
	const style: React.CSSProperties = {fontFamily: sansStack(p.mono.family), fontWeight: p.mono.weight, letterSpacing: '-0.01em', lineHeight: 1.3};
	const field = p.box === 'field';
	const maxW = p.maxWidth * W - (field ? 230 * u : 0);
	const size = useMemo(
		() => fitFontSize({text: rich.plain, style, base: p.size * u, maxWidth: maxW, maxHeight: H * 0.55}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[rich.plain, p.size, u, maxW, H, p.mono.family, p.mono.weight],
	);
	// typing schedule: time each visible char appears (spaces and punctuation add natural pauses)
	const times = useMemo(() => {
		const out: number[] = [];
		let tt = p.start;
		const base = 1 / p.cps;
		rich.words.forEach((w, wi) => {
			if (wi > 0) tt += base * rnd(`sp${wi}`, 0.8, 1.6);
			for (let k = 0; k < w.text.length; k++) {
				const prev = k > 0 ? w.text[k - 1] : '';
				tt += base * rnd(`c${w.charStart + k}`, 0.55, 1.45) + (/[,.?!:;]/.test(prev) ? 0.18 : 0);
				out.push(tt);
			}
		});
		return out;
	}, [rich, p.cps, p.start]);
	const typed = times.filter((x) => x <= t).length;
	const done = times.length ? times[times.length - 1] : p.start;
	const lastTyped = typed > 0 ? times[typed - 1] : 0;
	const sinceKey = t - lastTyped;
	const typing = typed > 0 && typed < times.length && sinceKey < 0.45;
	const blink = typing ? 1 : Math.max(0, Math.min(1, 0.5 + 1.8 * Math.cos(((t - (typed ? lastTyped : 0)) / 1.05) * Math.PI * 2)));
	const hl = p.highlight ? done + 0.25 : Infinity;
	const intro = sp(frame, fps, 0, {damping: 18, stiffness: 150});
	const caret = (before: boolean) => (
		<span
			style={{
				position: 'absolute',
				left: before ? '-0.13em' : '100%',
				top: '0.12em',
				width: '0.09em',
				height: '1.08em',
				marginLeft: '0.04em',
				borderRadius: '0.03em',
				background: theme.accent,
				opacity: p.caret ? blink : 0,
				boxShadow: `0 0 ${10 * u}px ${rgba(theme.accent, 0.8)}`,
			}}
		/>
	);
	const drift = map(t, [0, Ds], [0, 1]);
	const content = (
		<div style={{...style, fontSize: size, color: theme.fg, textAlign: p.align, width: 'max-content', maxWidth: maxW, textShadow: field ? undefined : liftShadow(u, 0.35)}}>
			{rich.lines.map((line, li) => (
				<div key={li}>
					{line.map((w, wi) => {
						let ci = w.charStart;
						return (
							<React.Fragment key={wi}>
								{wi > 0 ? ' ' : null}
								<span style={{display: 'inline-block', whiteSpace: 'nowrap', position: 'relative'}}>
									{w.segs.map((s, si) => {
										const chip = s.accent ? ease.outExpo(prog(t, hl, hl + 0.45)) : 0;
										return (
											<span key={si} style={{position: 'relative', display: 'inline-block'}}>
												{s.accent && chip > 0 ? (
													<span
														style={{
															position: 'absolute',
															left: '-0.1em',
															right: '-0.1em',
															top: '0.08em',
															bottom: '0.02em',
															borderRadius: '0.14em',
															background: theme.accent,
															transform: `scaleX(${chip})`,
															transformOrigin: 'left center',
															boxShadow: `0 0 ${18 * u}px ${rgba(theme.accent, 0.45)}`,
														}}
													/>
												) : null}
												{Array.from(s.text).map((ch) => {
													const i = ci++;
													const vis = i < typed;
													const isLast = i === typed - 1;
													const pop = vis ? map(t - times[i], [0, 0.06], [0.6, 1]) : 0;
													return (
														<span
															key={i}
															style={{
																position: 'relative',
																display: 'inline-block',
																whiteSpace: 'pre',
																opacity: vis ? pop : 0,
																color: s.accent && chip > 0.5 ? onColor(theme.accent) : s.accent ? theme.accent : theme.fg,
															}}
														>
															{ch}
															{isLast ? caret(false) : null}
															{typed === 0 && i === 0 ? caret(true) : null}
														</span>
													);
												})}
											</span>
										);
									})}
								</span>
							</React.Fragment>
						);
					})}
				</div>
			))}
		</div>
	);
	if (!field) {
		return (
			<AbsoluteFill>
				<Anchor x={p.x} y={p.y} W={W} H={H} transform={`scale(${1 + 0.02 * drift})`}>
					{content}
				</Anchor>
			</AbsoluteFill>
		);
	}
	const sent = prog(t, done + 0.2, done + 0.5, ease.outCubic);
	const iconS = size * 0.9;
	return (
		<AbsoluteFill>
			<Anchor x={p.x} y={p.y} W={W} H={H} transform={`translateY(${(1 - intro) * 60 * u}px) scale(${(0.94 + 0.06 * intro) * (1 + 0.015 * drift)})`} style={{opacity: Math.min(1, intro * 1.5)}}>
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 26 * u,
						padding: `${30 * u}px ${30 * u}px ${30 * u}px ${38 * u}px`,
						minWidth: Math.min(p.maxWidth * W, 900 * u),
						borderRadius: 44 * u,
						background: `linear-gradient(180deg, ${rgba('#FFFFFF', 0.16)}, ${rgba('#FFFFFF', 0.08)})`,
						border: `${2 * u}px solid ${rgba('#FFFFFF', 0.22)}`,
						boxShadow: `0 ${24 * u}px ${60 * u}px rgba(0,0,0,0.35), inset 0 ${1.5 * u}px 0 ${rgba('#FFFFFF', 0.25)}, 0 0 ${50 * u}px ${rgba(theme.glow, 0.25 + 0.1 * breathe(t, 2.6))}`,
						backdropFilter: `blur(${24 * u}px)`,
					}}
				>
					<svg width={iconS} height={iconS} viewBox="0 0 24 24" style={{flexShrink: 0, opacity: 0.75}}>
						<circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke={theme.fg} strokeWidth="2.4" />
						<path d="M15.5 15.5 L21 21" stroke={theme.fg} strokeWidth="2.6" strokeLinecap="round" />
					</svg>
					<div style={{flex: 1}}>{content}</div>
					<div
						style={{
							flexShrink: 0,
							width: size * 1.35,
							height: size * 1.35,
							borderRadius: '50%',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							background: sent > 0 ? theme.accent : rgba('#FFFFFF', 0.18),
							transform: `scale(${1 + 0.15 * Math.sin(Math.PI * sent)})`,
							boxShadow: sent > 0 ? `0 0 ${24 * u}px ${rgba(theme.accent, 0.7 * sent)}` : undefined,
						}}
					>
						<svg width={size * 0.7} height={size * 0.7} viewBox="0 0 24 24">
							<path d="M12 19 V5 M5.5 11.5 L12 5 L18.5 11.5" fill="none" stroke={sent > 0 ? onColor(theme.accent) : theme.fg} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					</div>
				</div>
			</Anchor>
		</AbsoluteFill>
	);
};

export const textTypewriter = defineLook({
	id: 'text-typewriter',
	category: 'text',
	kind: 'overlay',
	duration: 3.5,
	description: 'Text types itself character by character (natural cadence, pauses at punctuation) in Space Mono with a glowing blinking caret; **accent** words get an accent chip swept behind them after typing. box=field wraps it in a frosted search/prompt field.',
	usesFont2: false,
	extraFonts: (p) => {
		const m = (p as unknown as {mono: {family: string; weight: number}}).mono;
		return [{family: m.family, weight: m.weight}];
	},
	props,
	render: TextTypewriter,
});
