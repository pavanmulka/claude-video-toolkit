import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {breathe, ease, map, prog, rnd} from '../lib/anim';
import {glowShadow, liftShadow, rgba} from '../lib/color';
import {fontCss} from '../lib/fonts';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {fitFontSize} from '../lib/measure';
import {parseRich} from '../lib/rich';
import {bool, num, str} from '../lib/schema';
import {Anchor, Segs} from '../lib/text';

const props = {
	text: str('Every **flight.** Every **hotel.**\nOne place.', 'Text; **word** = accent colour, *word* = italic font2, \\n = line break'),
	size: num(104, 'Font size in design units (auto-shrinks to fit)', 20, 400),
	maxWidth: num(0.86, 'Max text width as a fraction of the frame width', 0.2, 1),
	upper: bool(false, 'ALL CAPS'),
	wordDuration: num(0.3, 'Seconds the spark takes to sweep across one word', 0.05, 3),
	gap: num(0.06, 'Pause between words in seconds', 0, 3),
	trail: num(260, 'Maximum trail length (design units)', 0, 2000),
	glow: num(0.7, 'Glow intensity 0-1', 0, 1),
	x: num(0.5, 'Horizontal centre (fraction of width)', 0, 1),
	y: num(0.5, 'Vertical centre (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const Spark: React.FC<{p: number; after: number; trail: number; color: string; glow: string; u: number; seed: string}> = ({p, after, trail, color, glow, u, seed}) => {
	// after: seconds since the sweep finished (flare + fade)
	const fade = after > 0 ? Math.max(0, 1 - after / 0.22) : 1;
	if (fade <= 0) return null;
	const speed = Math.sin(Math.PI * Math.min(1, p)); // fastest mid-word
	const len = trail * u * (0.3 + 0.7 * speed) * (after > 0 ? fade : 1);
	const arc = -Math.sin(Math.PI * Math.min(1, p)) * 8 * u;
	const core = 13 * u * (1 + (after > 0 ? 0.8 * (1 - fade) : 0));
	return (
		<div style={{position: 'absolute', left: `${Math.min(1, p) * 100}%`, top: '54%', width: 0, height: 0, transform: `translateY(${arc}px)`, opacity: fade}}>
			{/* trail */}
			<div
				style={{
					position: 'absolute',
					right: 0,
					top: -3 * u,
					width: len,
					height: 6 * u,
					borderRadius: 6 * u,
					background: `linear-gradient(90deg, ${rgba(color, 0)} 0%, ${rgba(color, 0.35)} 45%, ${rgba(color, 0.9)} 85%, #FFFFFF 100%)`,
					filter: `blur(${1.2 * u}px)`,
					boxShadow: `0 0 ${14 * u}px ${rgba(glow, 0.55)}`,
				}}
			/>
			{/* shed particles */}
			{[0, 1, 2, 3, 4].map((k) => {
				const back = (0.18 + k * 0.17) * len;
				const dy = rnd(`${seed}py${k}`, -1, 1) * 12 * u * (0.4 + k * 0.25);
				const s = (4 - k * 0.6) * u;
				return (
					<div
						key={k}
						style={{
							position: 'absolute',
							left: -back - s / 2,
							top: dy - s / 2,
							width: s,
							height: s,
							borderRadius: '50%',
							background: k % 2 ? color : '#FFFFFF',
							opacity: 0.85 - k * 0.15,
							boxShadow: `0 0 ${6 * u}px ${rgba(color, 0.9)}`,
						}}
					/>
				);
			})}
			{/* core */}
			<div
				style={{
					position: 'absolute',
					left: -core / 2,
					top: -core / 2,
					width: core,
					height: core,
					borderRadius: '50%',
					background: '#FFFFFF',
					boxShadow: `0 0 ${10 * u}px ${4 * u}px ${rgba(color, 0.95)}, 0 0 ${34 * u}px ${10 * u}px ${rgba(glow, 0.6)}`,
				}}
			/>
		</div>
	);
};

const TextTrail: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, font2, Ds} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const rich = useMemo(() => parseRich(p.text, {upper: p.upper}), [p.text, p.upper]);
	const style: React.CSSProperties = {...fontCss(font), letterSpacing: '-0.01em', lineHeight: 1.12};
	const maxW = p.maxWidth * W;
	const size = useMemo(
		() => fitFontSize({text: rich.plain, style, base: p.size * u, maxWidth: maxW, maxHeight: H * 0.6}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[rich.plain, p.size, u, maxW, H, font.family, font.weight, font.stretch],
	);
	const step = p.wordDuration + p.gap;
	const drift = map(t, [0, Ds], [0, 1]);
	return (
		<AbsoluteFill>
			<Anchor x={p.x} y={p.y} W={W} H={H} width={maxW} transform={`scale(${1 + 0.02 * drift})`}>
				<div style={{...style, fontSize: size, textAlign: 'center', textWrap: 'balance'} as React.CSSProperties}>
					{rich.lines.map((line, li) => (
						<div key={li}>
							{line.map((w, wi) => {
								const s0 = 0.1 + w.index * step;
								const raw = prog(t, s0, s0 + p.wordDuration);
								const pe = ease.inOutCubic(raw);
								const after = t - (s0 + p.wordDuration);
								const soft = 18;
								const edge = pe * (100 + soft);
								const mask = raw >= 1 ? undefined : `linear-gradient(90deg, #000 0%, #000 ${edge - soft}%, transparent ${edge}%)`;
								const flash = after > 0 ? Math.exp(-after / 0.35) : 0;
								const glowC = w.accent || w.em ? theme.accent : theme.glow;
								const g = p.glow * (0.35 + 0.9 * flash + (w.accent ? 0.25 * breathe(t, 2.2, w.index * 0.3) : 0));
								return (
									<React.Fragment key={wi}>
										{wi > 0 ? ' ' : null}
										<span style={{display: 'inline-block', position: 'relative', whiteSpace: 'nowrap'}}>
											<span
												style={{
													display: 'inline-block',
													opacity: t < s0 ? 0 : 1,
													WebkitMaskImage: mask,
													maskImage: mask,
													transform: `translateY(${(1 - pe) * 8 * u}px)`,
													textShadow: `${glowShadow(glowC, g, u)}, ${liftShadow(u, 0.3)}`,
												}}
											>
												<Segs word={w} fg={theme.fg} accent={theme.accent} font2={font2} />
											</span>
											{t >= s0 ? <Spark p={pe} after={after} trail={p.trail} color={theme.accent} glow={theme.glow} u={u} seed={`sp${w.index}`} /> : null}
										</span>
									</React.Fragment>
								);
							})}
						</div>
					))}
				</div>
			</Anchor>
		</AbsoluteFill>
	);
};

export const textTrail = defineLook({
	id: 'text-trail',
	category: 'text',
	kind: 'overlay',
	duration: 3,
	description: 'Words appear one at a time, each revealed by a bright spark sweeping across it with a comet trail and shed particles; revealed words flash with a soft glow.',
	props,
	render: TextTrail,
});
