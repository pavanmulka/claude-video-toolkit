import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {breathe, lerp, map, shake, sp} from '../lib/anim';
import {glowShadow, liftShadow} from '../lib/color';
import {fontCss} from '../lib/fonts';
import {Shockwave, SparkleField, SpeedLines} from '../lib/fx';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {fitFontSize} from '../lib/measure';
import {parseRich} from '../lib/rich';
import {bool, int, num, str} from '../lib/schema';
import {Segs} from '../lib/text';

const props = {
	text: str("IT'S **HERE.**", 'Words (1-3 read best). **word** = accent colour, \\n = line break'),
	size: num(210, 'Font size in design units (auto-shrinks to fit)', 20, 700),
	maxWidth: num(0.86, 'Max text width as a fraction of the frame width', 0.2, 1),
	upper: bool(true, 'ALL CAPS'),
	stagger: num(0.14, 'Seconds between word punches', 0, 2),
	lines: bool(true, 'Radial speed lines on impact'),
	rays: int(34, 'Number of speed lines', 0, 160),
	glow: num(0.8, 'Glow intensity 0-1', 0, 1),
	shake: num(0.6, 'Camera shake on impact 0-1', 0, 1),
	sparkles: bool(true, 'Twinkling sparkles around the words after impact'),
	x: num(0.5, 'Horizontal centre (fraction of width)', 0, 1),
	y: num(0.5, 'Vertical centre (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const IMPACT = 0.11; // seconds from word start until the punch lands

const TextBurst: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, font2, Ds} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const rich = useMemo(() => parseRich(p.text, {upper: p.upper}), [p.text, p.upper]);
	const style: React.CSSProperties = {...fontCss(font), letterSpacing: '-0.012em', lineHeight: 0.94};
	const maxW = p.maxWidth * W;
	const size = useMemo(
		() => fitFontSize({text: rich.plain, style, base: p.size * u, maxWidth: maxW, maxHeight: H * 0.62}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[rich.plain, p.size, u, maxW, H, font.family, font.weight, font.stretch],
	);
	const cx = p.x * W;
	const cy = p.y * H;
	const nLines = rich.lines.length;
	const blockH = size * 0.94 * nLines;
	const impacts = rich.words.map((w) => w.index * p.stagger + IMPACT);
	const firstImpact = impacts[0] ?? IMPACT;
	const accentWord = rich.words.find((w) => w.accent);
	const accentImpact = accentWord ? impacts[accentWord.index] : null;

	const sh = shake(t, impacts, p.shake * 13 * u, 'burst');
	const drift = 1 + 0.035 * map(t, [firstImpact, Ds], [0, 1]);
	const r0 = Math.min(maxW * 0.36, size * 1.2);

	return (
		<AbsoluteFill>
			{/* back layer: burst graphics */}
			<AbsoluteFill style={{transform: `translate(${sh.x * 0.6}px, ${sh.y * 0.6}px)`}}>
				{p.lines ? (
					<>
						<SpeedLines t={t} t0={firstImpact - 0.02} cx={cx} cy={cy} W={W} H={H} u={u} count={p.rays} r0={r0} colors={[theme.fg, theme.fg, theme.accent, theme.accent2]} seed="b1" />
						{accentImpact !== null && accentImpact !== firstImpact ? (
							<SpeedLines t={t} t0={accentImpact - 0.02} cx={cx} cy={cy} W={W} H={H} u={u} count={Math.round(p.rays * 0.7)} r0={r0 * 1.1} colors={[theme.accent, theme.accent, theme.fg]} seed="b2" intensity={0.85} />
						) : null}
					</>
				) : null}
				<Shockwave t={t} t0={firstImpact} cx={cx} cy={cy} W={W} H={H} u={u} r0={r0 * 0.7} reach={Math.max(W, H) * 0.45} color={theme.glow} width={14} flash={0.55 * p.glow} />
				{accentImpact !== null && accentImpact !== firstImpact ? (
					<Shockwave t={t} t0={accentImpact} cx={cx} cy={cy} W={W} H={H} u={u} r0={r0 * 0.8} reach={Math.max(W, H) * 0.4} color={theme.accent} width={10} flash={0.4 * p.glow} />
				) : null}
				{p.sparkles ? (
					<SparkleField t={t} t0={(impacts[impacts.length - 1] ?? 0) + 0.1} cx={cx} cy={cy} w={Math.min(maxW, size * 4)} h={blockH + size} u={u} count={8} colors={[theme.accent, theme.fg, theme.accent2]} seed="bs" size={26} />
				) : null}
			</AbsoluteFill>
			{/* words */}
			<div
				style={{
					position: 'absolute',
					left: cx,
					top: cy,
					width: maxW,
					transform: `translate(-50%, -50%) translate(${sh.x}px, ${sh.y}px) rotate(${sh.r}deg) scale(${drift})`,
					textAlign: 'center',
					...style,
					fontSize: size,
				}}
			>
				{rich.lines.map((line, li) => (
					<div key={li} style={{textWrap: 'balance'} as React.CSSProperties}>
						{line.map((w, wi) => {
							const st = w.index * p.stagger;
							const s = sp(frame, fps, st, {damping: 11, stiffness: 250, mass: 0.62});
							const local = t - st;
							if (local < 0) {
								return (
									<React.Fragment key={wi}>
										{wi > 0 ? ' ' : null}
										<span style={{display: 'inline-block', opacity: 0}}>{w.text}</span>
									</React.Fragment>
								);
							}
							const scale = lerp(2.6, 1, s);
							const op = map(local, [0, 0.06], [0, 1]);
							const blur = map(s, [0, 0.9], [18 * u, 0]);
							const flash = local >= IMPACT ? Math.exp(-(local - IMPACT) / 0.22) : 0;
							const glowC = w.accent ? theme.accent : theme.glow;
							const g = p.glow * (0.5 + 0.85 * flash + 0.14 * breathe(t, 2.4, w.index * 0.4));
							const ghost = Math.max(0, 1 - s);
							const textStyle: React.CSSProperties = {
								textShadow: `${glowShadow(glowC, g, u)}, ${liftShadow(u, 0.32)}`,
							};
							return (
								<React.Fragment key={wi}>
									{wi > 0 ? ' ' : null}
									<span
										style={{
											display: 'inline-block',
											position: 'relative',
											transform: `scale(${scale})`,
											opacity: op,
											filter: blur > 0.4 ? `blur(${blur}px)` : undefined,
										}}
									>
										{ghost > 0.02
											? [1.28, 1.6].map((k, gi) => (
													<span
														key={gi}
														style={{position: 'absolute', left: 0, top: 0, width: '100%', transform: `scale(${1 + (k - 1) * ghost})`, opacity: 0.28 * ghost * (1 - gi * 0.4), color: w.accent ? theme.accent : theme.fg}}
													>
														{w.text}
													</span>
												))
											: null}
										<span style={textStyle}>
											<Segs word={w} fg={theme.fg} accent={theme.accent} font2={font2} />
										</span>
									</span>
								</React.Fragment>
							);
						})}
					</div>
				))}
			</div>
		</AbsoluteFill>
	);
};

export const textBurst = defineLook({
	id: 'text-burst',
	category: 'text',
	kind: 'overlay',
	duration: 2.5,
	description: '1-3 big words punch in at the centre (scale-slam with zoom ghosts), radial speed lines, shockwave ring, soft glow and sparkles; accent words in the accent colour.',
	font: {weight: 900, stretch: 82},
	props,
	render: TextBurst,
});
