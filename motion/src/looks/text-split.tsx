import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {SPRINGS, clamp01, sp} from '../lib/anim';
import {onColor, rgba} from '../lib/color';
import {fontCss} from '../lib/fonts';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {measureText} from '../lib/measure';
import {int, num, str} from '../lib/schema';

const props = {
	word: str('LIFE', 'The word that splits open'),
	insert: str('AUGUST', 'The word that slides in between the halves'),
	splitAt: int(2, 'Split after this many letters of `word`', 1, 30),
	size: num(220, 'Word size (design units)', 20, 600),
	insertSize: num(0.36, 'Inserted word size relative to `size`', 0.1, 1.5),
	pill: str('', 'Pill colour behind the inserted word (empty = theme accent)'),
	at: num(0.5, 'Seconds before the word opens', 0, 20),
	y: num(0.42, 'Vertical centre (fraction of height)', 0, 1),
	flash: num(1, 'Glow flash strength when the word lands (0 = none)', 0, 3),
	sub: str('', 'Small label under the title (optional)'),
};

type P = LookProps<typeof props>;

const TextSplit: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font} = useLook();
	const frame = useCurrentFrame();
	const left = p.word.slice(0, p.splitAt);
	const right = p.word.slice(p.splitAt);
	const base = p.size * u;
	const appear = clamp01(sp(frame, fps, 0, SPRINGS.pop));
	const open = clamp01(sp(frame, fps, p.at, SPRINGS.snappy));
	const land = clamp01(sp(frame, fps, p.at + 0.12, SPRINGS.bouncy));
	const pillC = p.pill || theme.accent;
	// measure the real widths and shrink everything to fit 92% of the frame when fully open
	const wordStyle = (fs: number): React.CSSProperties => ({...fontCss(font, {weight: 900, stretch: 75}), fontSize: fs, lineHeight: 1, textTransform: 'uppercase'});
	const insStyle = (fs: number): React.CSSProperties => ({...fontCss(font, {weight: 900}), fontSize: fs, letterSpacing: fs * 0.12, textTransform: 'uppercase'});
	const wl = measureText(left, wordStyle(base)).width;
	const wr = measureText(right, wordStyle(base)).width;
	const wi = measureText(p.insert, insStyle(base * p.insertSize)).width + base * p.insertSize * 0.8;
	const fit = Math.min(1, (0.92 * W) / (wl + wr + wi));
	const size = base * fit;
	const insSize = size * p.insertSize;
	const pillW = wi * fit;
	const glow = p.flash * Math.max(0, 1 - Math.abs((frame / fps - p.at - 0.35) / 0.35));
	const word: React.CSSProperties = {...fontCss(font, {weight: 900, stretch: 75}), fontSize: size, lineHeight: 1, color: theme.fg, textTransform: 'uppercase', whiteSpace: 'pre'};
	return (
		<AbsoluteFill>
			<div style={{position: 'absolute', left: 0, width: W, top: p.y * H - size / 2, height: size, display: 'flex', justifyContent: 'center', alignItems: 'center', transform: `scale(${0.8 + 0.2 * appear})`, opacity: appear, filter: glow > 0.01 ? `drop-shadow(0 0 ${30 * u * glow}px ${rgba(pillC, 0.9)})` : undefined}}>
				<div style={{...word}}>{left}</div>
				<div style={{width: open * pillW, height: insSize * 1.35, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'visible'}}>
					<div style={{transform: `scale(${land})`, opacity: land, background: pillC, borderRadius: insSize * 0.25, padding: `${insSize * 0.12}px ${insSize * 0.35}px`, boxShadow: `0 0 ${(14 + 40 * glow) * u}px ${rgba(pillC, 0.6 + 0.4 * glow)}`, ...fontCss(font, {weight: 900}), fontSize: insSize, lineHeight: 1.05, color: onColor(pillC), letterSpacing: insSize * 0.12, textTransform: 'uppercase', whiteSpace: 'nowrap'}}>
						{p.insert}
					</div>
				</div>
				<div style={{...word}}>{right}</div>
			</div>
			{p.sub ? (
				<div style={{position: 'absolute', top: p.y * H + size * 0.62, width: W, textAlign: 'center', ...fontCss(font, {weight: 700}), fontSize: 34 * u, letterSpacing: 6 * u, color: rgba(theme.fg, 0.85), opacity: land, textTransform: 'uppercase'}}>{p.sub}</div>
			) : null}
		</AbsoluteFill>
	);
};

export const textSplit = defineLook({
	id: 'text-split',
	category: 'text',
	kind: 'overlay',
	duration: 2.5,
	outro: 0.3,
	usesFont2: false,
	description: 'A big word splits open and a second word slides in between on a glowing accent pill ("LI [AUGUST] FE"), with a glow flash as it lands: titles, chapter cards, "TEAM [LAUNCH] PLAN".',
	props,
	render: TextSplit,
});
