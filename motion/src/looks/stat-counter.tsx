import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {breathe, ease, formatNumber, lerp, map, prog, resolveDecimals, sp, type NumberFormat} from '../lib/anim';
import {glowShadow, liftShadow, rgba} from '../lib/color';
import {fontCss} from '../lib/fonts';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {measureText} from '../lib/measure';
import {parseRich} from '../lib/rich';
import {bool, int, num, oneOf, str} from '../lib/schema';
import {Anchor, Segs} from '../lib/text';

export const FORMATS = ['integer', 'decimal', 'percent', 'currency', 'time', 'compact'] as const;

const props = {
	from: num(0, 'Start value', -1e12, 1e12),
	to: num(12400, 'End value', -1e12, 1e12),
	format: oneOf(FORMATS, 'integer', 'integer 12,400 | decimal 4.8 | percent 98% | currency $1,200 | time m:ss (value in seconds) | compact 12.4K'),
	decimals: int(-1, 'Decimals shown while counting; -1 = automatic: as many as `to` has (118 -> 0, 4.5 -> 1)', -1, 6),
	prefix: str('', 'Text before the number (e.g. "+", "~")'),
	suffix: str('', 'Text after the number (e.g. "x", " hrs")'),
	currency: str('$', 'Currency symbol for format=currency'),
	separator: str(',', 'Thousands separator'),
	label: str('trips **organized**', 'Label under the number (**accent** markup)'),
	countDuration: num(1.8, 'Seconds the count takes', 0.1, 30),
	size: num(250, 'Number size in design units (auto-fits the width)', 20, 800),
	labelSize: num(58, 'Label size in design units', 10, 200),
	outline: bool(true, 'Giant outline copy of the number drifting behind'),
	glow: num(0.7, 'Glow intensity 0-1', 0, 1),
	x: num(0.5, 'Horizontal centre (fraction of width)', 0, 1),
	y: num(0.47, 'Vertical centre (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

const StatCounter: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, font2, Ds} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const fmt = {format: p.format as NumberFormat, decimals: resolveDecimals(p.decimals, p.to, p.format as NumberFormat), currency: p.currency, separator: p.separator};
	const finalText = formatNumber(p.to, fmt);
	const style: React.CSSProperties = {...fontCss(font), fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.03em', lineHeight: 1};
	const affix = (s: string) => (s ? measureText(s, {...style, fontSize: p.size * u * 0.55}).width : 0);
	const size = useMemo(() => {
		const base = p.size * u;
		const w = measureText(finalText, {...style, fontSize: base}).width + affix(p.prefix) + affix(p.suffix);
		return Math.min(base, (base * W * 0.88) / Math.max(1, w));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [finalText, p.size, u, W, p.prefix, p.suffix, font.family, font.weight, font.stretch]);
	const start = 0.15;
	const c = ease.outExpo(prog(t, start, start + p.countDuration));
	const value = lerp(p.from, p.to, c);
	const text = formatNumber(value, fmt);
	const land = start + p.countDuration * 0.92;
	const bump = sp(frame, fps, land, {damping: 9, stiffness: 220, mass: 0.6});
	const landed = t >= land;
	const bumpScale = landed ? 1 + 0.07 * Math.sin(Math.PI * Math.min(1, bump)) * (1 - Math.min(1, (t - land) / 0.6)) : 1;
	const intro = sp(frame, fps, 0, {damping: 16, stiffness: 150});
	const speed = 1 - c; // fast early
	const flash = landed ? Math.exp(-(t - land) / 0.35) : 0;
	const labelE = ease.outExpo(prog(t, 0.35, 1.15));
	const rich = useMemo(() => parseRich(p.label), [p.label]);
	const drift = map(t, [0, Ds], [0, 1]);
	const g = p.glow * (0.55 + 0.8 * flash + 0.15 * breathe(t, 2.6));
	const ping = landed ? prog(t, land, land + 0.9) : 0;
	return (
		<AbsoluteFill>
			{p.outline ? (
				<div
					style={{
						position: 'absolute',
						left: p.x * W,
						top: p.y * H,
						transform: `translate(-50%, -52%) translateX(${lerp(7, -7, drift)}%) scale(${lerp(1.12, 1, ease.outCubic(prog(t, 0, 1.2)))})`,
						...style,
						fontSize: size * 2.15,
						whiteSpace: 'nowrap',
						color: 'transparent',
						WebkitTextStroke: `${3 * u}px ${rgba(theme.accent2, 0.7)}`,
						opacity: 0.5 * ease.outCubic(prog(t, 0.1, 0.9)),
					}}
				>
					{p.prefix}
					{finalText}
					{p.suffix}
				</div>
			) : null}
			<Anchor x={p.x} y={p.y} W={W} H={H} transform={`scale(${(0.9 + 0.1 * intro) * (1 + 0.02 * drift)})`} style={{display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
				<div
					style={{
						position: 'relative',
						...style,
						fontSize: size,
						whiteSpace: 'nowrap',
						color: theme.fg,
						opacity: Math.min(1, intro * 1.4),
						transform: `scale(${bumpScale})`,
						filter: speed > 0.35 && t > start ? `blur(${(speed - 0.35) * 5 * u}px)` : undefined,
						textShadow: `${glowShadow(theme.glow, g, u, 1.2)}, ${liftShadow(u, 0.35)}`,
					}}
				>
					{p.prefix ? <span style={{color: theme.accent, fontSize: '0.55em', verticalAlign: '0.62em', marginRight: '0.04em'}}>{p.prefix}</span> : null}
					<span>{text}</span>
					{p.suffix ? <span style={{color: theme.accent, fontSize: '0.55em', marginLeft: '0.04em'}}>{p.suffix}</span> : null}
					{ping > 0 && ping < 1 ? (
						<span
							aria-hidden
							style={{
								position: 'absolute',
								inset: 0,
								whiteSpace: 'nowrap',
								color: 'transparent',
								textShadow: 'none',
								backgroundImage: `linear-gradient(100deg, transparent ${ping * 150 - 50 - 16}%, rgba(255,255,255,0.95) ${ping * 150 - 50}%, ${theme.accent} ${ping * 150 - 50 + 8}%, transparent ${ping * 150 - 50 + 22}%)`,
								WebkitBackgroundClip: 'text',
								backgroundClip: 'text',
								WebkitTextFillColor: 'transparent',
							}}
						>
							{p.prefix ? <span style={{fontSize: '0.55em', verticalAlign: '0.62em', marginRight: '0.04em'}}>{p.prefix}</span> : null}
							<span>{text}</span>
							{p.suffix ? <span style={{fontSize: '0.55em', marginLeft: '0.04em'}}>{p.suffix}</span> : null}
						</span>
					) : null}
				</div>
				{p.label ? (
					<div
						style={{
							...fontCss(font, {weight: Math.min(font.weight, 700)}),
							fontSize: p.labelSize * u,
							lineHeight: 1.15,
							marginTop: 18 * u,
							maxWidth: W * 0.84,
							textAlign: 'center',
							color: theme.fg,
							opacity: labelE * 0.92,
							transform: `translateY(${(1 - labelE) * 24 * u}px)`,
							textShadow: liftShadow(u, 0.35),
						}}
					>
						{rich.words.map((w, wi) => (
							<React.Fragment key={wi}>
								{wi > 0 ? ' ' : null}
								<Segs word={w} fg={theme.fg} accent={theme.accent} font2={font2} />
							</React.Fragment>
						))}
					</div>
				) : null}
			</Anchor>
		</AbsoluteFill>
	);
};

export const statCounter = defineLook({
	id: 'stat-counter',
	category: 'number',
	kind: 'overlay',
	duration: 3,
	description: 'Big number counts from `from` to `to` (expo ease, motion blur while fast, bump + glow + light sweep when it lands) with a label below and a giant outline copy drifting behind. Formats: integer, decimal, percent, currency, time (m:ss), compact (12.4K); decimals follow `to` unless set.',
	font: {weight: 900},
	props,
	render: StatCounter,
});
