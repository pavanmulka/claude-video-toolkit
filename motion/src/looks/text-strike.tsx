import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {breathe, ease, lerp, map, prog, rnd, sp} from '../lib/anim';
import {glowShadow, liftShadow, rgba} from '../lib/color';
import {fontCss} from '../lib/fonts';
import {Sparkle} from '../lib/fx';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {fitFontSize, measureText} from '../lib/measure';
import {parseRich, stripMarkup} from '../lib/rich';
import {bool, color, num, str} from '../lib/schema';
import {Anchor, Segs} from '../lib/text';

const props = {
	prefix: str('Plan with', 'Line above the swapped word (optional)'),
	from: str('spreadsheets', 'Word that gets struck through and drops away'),
	to: str('**one app.**', 'Word that pops in (**accent** markup; plain text is accent-coloured automatically)'),
	suffix: str('', 'Line below (optional)'),
	size: num(170, 'Size of the swapped word (design units, auto-fits)', 20, 500),
	prefixSize: num(72, 'Size of the prefix/suffix lines (design units)', 10, 300),
	swapAt: num(0.95, 'Seconds until the strike-through starts', 0.1, 20),
	strikeColor: color('#FF4D6D', 'Strike-through colour'),
	upper: bool(false, 'ALL CAPS'),
	sparkles: bool(true, 'Sparkles when the new word lands'),
	x: num(0.5, 'Horizontal centre (fraction of width)', 0, 1),
	y: num(0.5, 'Vertical centre (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const TextStrike: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, font2, Ds} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const up = (s: string) => (p.upper ? s.toLocaleUpperCase() : s);
	const toText = /\*/.test(p.to) ? p.to : `**${p.to}**`;
	const toRich = useMemo(() => parseRich(toText, {upper: p.upper}), [toText, p.upper]);
	const fromPlain = up(stripMarkup(p.from));
	const style: React.CSSProperties = {...fontCss(font), letterSpacing: '-0.02em', lineHeight: 1.0};
	const maxW = W * 0.86;
	const size = useMemo(() => {
		const a = fitFontSize({text: fromPlain, style, base: p.size * u, maxWidth: maxW});
		const b = fitFontSize({text: toRich.plain, style, base: p.size * u, maxWidth: maxW});
		return Math.min(a, b);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [fromPlain, toRich.plain, p.size, u, maxW, font.family, font.weight, font.stretch]);
	const smallStyle: React.CSSProperties = {...fontCss(font, {weight: Math.min(font.weight, 700)}), fontSize: p.prefixSize * u, lineHeight: 1.1, letterSpacing: '-0.01em'};
	const fromW = measureText(fromPlain, {...style, fontSize: size}).width;

	// timeline
	const pre = ease.outExpo(prog(t, 0.05, 0.75));
	const fromIn = sp(frame, fps, 0.18, {damping: 16, stiffness: 180});
	const strike = ease.outCubic(prog(t, p.swapAt, p.swapAt + 0.3));
	const fallT = Math.max(0, t - (p.swapAt + 0.38));
	const fall = fallT > 0;
	// small hop, then gravity
	const fallY = -700 * u * fallT + 0.5 * 9000 * u * fallT * fallT;
	const fallRot = 14 * Math.min(1, fallT * 4) + fallT * 60;
	const fromOpacity = fall ? Math.max(0, 1 - fallT / 0.3) : Math.min(1, fromIn * 1.5);
	const toStart = p.swapAt + 0.6;
	const toS = sp(frame, fps, toStart, {damping: 10, stiffness: 190, mass: 0.8});
	const toLocal = t - toStart;
	const flash = toLocal > 0.1 ? Math.exp(-(toLocal - 0.1) / 0.3) : 0;
	const drift = map(t, [0, Ds], [0, 1]);
	return (
		<AbsoluteFill>
			<Anchor x={p.x} y={p.y} W={W} H={H} width={maxW} transform={`scale(${1 + 0.025 * drift})`} style={{display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center'}}>
				{p.prefix ? (
					<div style={{...smallStyle, color: theme.fg, opacity: pre, transform: `translateY(${(1 - pre) * 30 * u}px)`, textShadow: liftShadow(u, 0.35), marginBottom: 12 * u}}>
						{up(p.prefix)}
					</div>
				) : null}
				<div style={{position: 'relative', display: 'grid', placeItems: 'center', ...style, fontSize: size, height: size * 1.12, width: '100%'}}>
					{/* from word + strike */}
					{fromOpacity > 0.001 ? (
						<div
							style={{
								gridArea: '1 / 1',
								position: 'relative',
								whiteSpace: 'nowrap',
								color: strike > 0.5 ? theme.muted : theme.fg,
								opacity: fromOpacity,
								transform: `translateY(${fallY}px) rotate(${fall ? fallRot : 0}deg) scale(${lerp(0.86, 1, fromIn) * (fall ? 1 - 0.1 * Math.min(1, fallT * 2) : 1)})`,
								filter: fall ? `blur(${Math.min(8, fallT * 25) * u}px)` : undefined,
								textShadow: liftShadow(u, 0.3),
							}}
						>
							{fromPlain}
							<div
								style={{
									position: 'absolute',
									left: -fromW * 0.06,
									width: fromW * 1.12,
									top: '50%',
									height: Math.max(6, size * 0.085),
									marginTop: -Math.max(6, size * 0.085) / 2,
									borderRadius: size,
									background: p.strikeColor,
									transform: `rotate(-4deg) scaleX(${strike})`,
									transformOrigin: 'left center',
									boxShadow: `0 0 ${16 * u}px ${rgba(p.strikeColor, 0.7)}`,
								}}
							/>
						</div>
					) : null}
					{/* to word */}
					{toLocal > 0 ? (
						<div
							style={{
								gridArea: '1 / 1',
								whiteSpace: 'nowrap',
								transform: `scale(${lerp(0.35, 1, toS)})`,
								opacity: Math.min(1, toLocal / 0.08),
								filter: toS < 0.85 ? `blur(${(1 - toS) * 12 * u}px)` : undefined,
								textShadow: `${glowShadow(theme.accent, 0.5 + 0.9 * flash + 0.2 * breathe(t, 2.2), u)}, ${liftShadow(u, 0.3)}`,
							}}
						>
							{toRich.words.map((w, wi) => (
								<React.Fragment key={wi}>
									{wi > 0 ? ' ' : null}
									<Segs word={w} fg={theme.fg} accent={theme.accent} font2={font2} />
								</React.Fragment>
							))}
						</div>
					) : null}
					{p.sparkles && toLocal > 0.05
						? Array.from({length: 7}, (_, i) => {
								const lt = toLocal - 0.05;
								const life = 0.9;
								if (lt > life) return null;
								const a = (i / 7) * Math.PI * 2 + rnd(`ts${i}`, -0.3, 0.3);
								const d = ease.outCubic(Math.min(1, lt / life)) * size * rnd(`td${i}`, 1.1, 1.8);
								return (
									<Sparkle
										key={i}
										x={W * 0.43 + Math.cos(a) * d * 1.6}
										y={size * 0.56 + Math.sin(a) * d * 0.7}
										size={rnd(`tz${i}`, 14, 26) * u * (1 - lt / life)}
										color={i % 2 ? theme.accent : theme.fg}
										opacity={1 - lt / life}
										rotate={lt * 180}
									/>
								);
							})
						: null}
				</div>
				{p.suffix ? (
					<div style={{...smallStyle, color: theme.fg, opacity: pre, marginTop: 14 * u, textShadow: liftShadow(u, 0.35)}}>{up(p.suffix)}</div>
				) : null}
			</Anchor>
		</AbsoluteFill>
	);
};

export const textStrike = defineLook({
	id: 'text-strike',
	category: 'text',
	kind: 'overlay',
	duration: 3,
	description: 'Correction beat: shows the `from` word, a glowing line strikes through it, it tips and drops away with gravity, and the accent `to` word springs in with a glow flash and sparkles (e.g. folders -> people).',
	props,
	render: TextStrike,
});
