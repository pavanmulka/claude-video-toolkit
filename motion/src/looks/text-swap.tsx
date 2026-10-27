import React, {useMemo} from 'react';
import {AbsoluteFill, Img, spring, useCurrentFrame} from 'remotion';
import {z} from 'zod';
import {clamp01, ease, lerp, prog} from '../lib/anim';
import {mix, rgba} from '../lib/color';
import {EMOJI_STACK, font2Css, fontCss} from '../lib/fonts';
import {assetSrc, defineLook, useLook, type LookProps} from '../lib/look';
import {measureText} from '../lib/measure';
import {MBlurDefs, mblurStyle, motionStd, type MBlur} from '../lib/motion-blur';
import {parseRich, type Word} from '../lib/rich';
import {bool, doc, num, oneOf, strList} from '../lib/schema';

const props = {
	phrases: strList(
		['Peak', 'Peak 💰 earning', 'Peak spending years'],
		'Phrases shown one after another. Words shared with the previous phrase stay and glide to their new place, removed words exit, new words arrive. **word** = accent, *word* = font2 italic, \\n = line break; a lone emoji or [[img:name]] token grows from a point',
	),
	hold: num(0, 'Seconds each phrase holds before the next starts; 0 = auto (spread over the duration, the last phrase holds longest)', 0, 60),
	times: doc(z.array(z.number().min(0)).default([]), 'Explicit start time in seconds of each phrase (overrides hold), e.g. [0, 0.8, 1.9]'),
	size: num(120, 'Text size in design units (phrases shrink to fit maxWidth)', 10, 600),
	maxWidth: num(0.88, 'Max line width as a fraction of the frame width', 0.2, 1),
	upper: bool(false, 'ALL CAPS'),
	fit: oneOf(['all', 'each'] as const, 'all', 'all = every phrase uses the same text size (the one that fits the longest); each = every phrase fits on its own (shared words then resize as they glide)'),
	wrap: bool(false, 'Wrap long phrases onto more lines instead of shrinking them (explicit \\n always breaks)'),
	small: strList([], 'Words drawn small (smallScale x size, baseline-aligned), e.g. ["to", "are"] for "25 to 44" / "54% are"'),
	smallScale: num(0.5, 'Size of `small` words relative to size', 0.1, 1),
	enter: oneOf(['slide', 'grow'] as const, 'slide', 'How new words arrive: slide in from the right with a horizontal motion blur, or grow from a point (emoji and images always grow)'),
	exit: oneOf(['shrink', 'slide', 'mix'] as const, 'shrink', 'How removed words leave: shrink to their centre, slide out to the left with motion blur, or mix (alternate per change)'),
	intro: oneOf(['slide', 'grow', 'zoom'] as const, 'slide', 'Entrance of the first phrase: slide / grow like `enter`, or zoom (starts huge, zooms down into place with a zoom + horizontal smear)'),
	speed: num(1, 'Animation speed multiplier (2 = every move takes half as long)', 0.25, 4),
	stagger: num(0.06, 'Seconds between new words arriving in the same change', 0, 1),
	blur: num(1, 'Motion-blur strength (0 = none). Blur follows speed: strong on fast moves, 0 when settled', 0, 4),
	imageSize: num(1.15, 'Emoji / image token height relative to the text size', 0.2, 4),
	images: doc(
		z.record(z.string(), z.string()).default({}),
		'Images for [[img:name]] tokens, e.g. {"bag": "/abs/bag.png"} (absolute file path, path inside motion/public, or URL); [[img:2]] = 2nd entry; [[img:<URL or public path>]] also works without an entry',
	),
	accentText: bool(true, 'Draw **accent** words in the accent colour (false = keep the text colour, e.g. with underline for the marker look)'),
	underline: bool(false, 'Highlighter underline (accent colour, rounded) draws left to right under **accent** words after they land'),
	shadow: num(0, 'Soft drop shadow under the words 0-1 (helps over busy video)', 0, 1),
	x: num(0.5, 'Horizontal centre (fraction of width)', 0, 1),
	y: num(0.5, 'Vertical centre (fraction of height)', 0, 1),
};

type P = LookProps<typeof props>;

type Kind = 'text' | 'emoji' | 'img';
type Tok = {key: string; kind: Kind; word: Word; src: string; small: boolean; fs: number; w: number; h: number; accent: boolean; span: number; line: number};
type Pose = {x: number; y: number; s: number};
type Placed = {tok: Tok; pose: Pose; joinRight: number};
type Track = {id: number; a: number; b: number; items: Placed[]; newIdx: number};

const IMG_RE = /^\[\[img:(.+)\]\]$/;
const EMOJI_PARTS = /[\p{Extended_Pictographic}‍️⃣\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/gu;
const isEmoji = (s: string) => /\p{Extended_Pictographic}/u.test(s) && s.replace(EMOJI_PARTS, '').trim() === '';

const upperWord = (w: Word): Word => ({...w, text: w.text.toLocaleUpperCase(), segs: w.segs.map((s) => ({...s, text: s.text.toLocaleUpperCase()}))});

const TextSwap: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font, font2, Ds, exit: outroP, outro} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const base = p.size * u;
	const sp = Math.max(0.25, p.speed);
	const ENTER = 0.42 / sp;
	const ZOOM_IN = 0.7 / sp;
	const GLIDE = 0.4 / sp;
	const EXIT = 0.24 / sp;
	const LAG = 0.07 / sp;
	const DIST = 0.3 * Math.min(W, H * 1.2);
	const gap = base * 0.27;
	const textStyle = useMemo<React.CSSProperties>(() => ({...fontCss(font), letterSpacing: '-0.02em', lineHeight: 1}), [font]);
	const imgEntries = Object.entries(p.images);

	// ---- tokens + layouts (measured once)
	const {tracks, times, phrases} = useMemo(() => {
		const smallSet = new Set(p.small.map((s) => s.toLocaleLowerCase()));
		const resolveImg = (name: string) => {
			if (p.images[name] !== undefined) return p.images[name];
			if (/^\d+$/.test(name) && imgEntries[Number(name) - 1]) return imgEntries[Number(name) - 1][1];
			return name;
		};
		const measureWord = (w: Word, fs: number) =>
			w.segs.reduce(
				(acc, s) => acc + measureText(s.text, s.em ? {...font2Css(font2), fontSize: fs * 1.12, lineHeight: 1, letterSpacing: '-0.01em'} : {...textStyle, fontSize: fs}).width,
				0,
			);
		const phraseToks: Tok[][] = p.phrases.map((ph) => {
			const rich = parseRich(ph);
			return rich.words.map((w0) => {
				const m = IMG_RE.exec(w0.text);
				if (m) {
					const src = resolveImg(m[1].trim());
					const s = base * p.imageSize;
					return {key: `img:${src}`, kind: 'img' as const, word: w0, src, small: false, fs: s, w: s, h: s, accent: false, span: -1, line: w0.line};
				}
				if (isEmoji(w0.text)) {
					const fs = base * p.imageSize * 0.86;
					const w = measureText(w0.text, {fontFamily: EMOJI_STACK, fontSize: fs, lineHeight: 1}).width;
					return {key: `emoji:${w0.text}`, kind: 'emoji' as const, word: w0, src: '', small: false, fs, w, h: fs, accent: false, span: -1, line: w0.line};
				}
				const w = p.upper ? upperWord(w0) : w0;
				const small = smallSet.has(w0.text.toLocaleLowerCase());
				const fs = base * (small ? p.smallScale : 1);
				return {key: `text:${w.text}`, kind: 'text' as const, word: w, src: '', small, fs, w: measureWord(w, fs), h: fs, accent: w.accent, span: w.span, line: w.line};
			});
		});
		// lines (explicit + optional wrap) at scale 1
		const maxW = p.maxWidth * W;
		const lineSets = phraseToks.map((toks) => {
			const lines: Tok[][] = [];
			let curLine = -1;
			for (const tk of toks) {
				const last = lines[lines.length - 1];
				if (tk.line !== curLine || !last) {
					lines.push([tk]);
					curLine = tk.line;
					continue;
				}
				const width = last.reduce((a, x) => a + x.w, 0) + gap * last.length + tk.w;
				if (p.wrap && width > maxW) lines.push([tk]);
				else last.push(tk);
			}
			return lines;
		});
		const lineW = (l: Tok[]) => l.reduce((a, x) => a + x.w, 0) + gap * Math.max(0, l.length - 1);
		const fitOf = (lines: Tok[][]) => Math.min(1, maxW / Math.max(1, ...lines.map(lineW)));
		const fitAll = Math.min(1, ...lineSets.map(fitOf));
		const cx = p.x * W;
		const cy = p.y * H;
		const layouts: Placed[][] = lineSets.map((lines) => {
			const s = p.fit === 'all' ? fitAll : fitOf(lines);
			const LH = base * 1.1 * s;
			const out: Placed[] = [];
			lines.forEach((line, li) => {
				const lw = lineW(line) * s;
				const ly = cy + (li - (lines.length - 1) / 2) * LH;
				let xx = cx - lw / 2;
				line.forEach((tk, ti) => {
					// small words share the big words' baseline (box centre sits ~0.35 em above the baseline)
					const yOff = tk.kind === 'text' && tk.small ? 0.35 * (base - tk.fs) * s : 0;
					const next = line[ti + 1];
					const joinRight = tk.accent && next && next.accent && next.span === tk.span && tk.span >= 0 ? gap : 0;
					out.push({tok: tk, pose: {x: xx + (tk.w * s) / 2, y: ly + yOff, s}, joinRight});
					xx += (tk.w + gap) * s;
				});
			});
			return out;
		});
		// tracks: a token that also exists in the previous phrase keeps its identity (FLIP)
		const trs: Track[] = [];
		let prevIds: number[] = [];
		layouts.forEach((lay, k) => {
			const used = new Set<number>();
			const ids: number[] = [];
			let fresh = 0;
			lay.forEach((pl) => {
				let match = -1;
				if (k > 0) {
					const prevLay = layouts[k - 1];
					for (let i = 0; i < prevLay.length; i++) {
						if (!used.has(i) && prevLay[i].tok.key === pl.tok.key) {
							match = i;
							break;
						}
					}
				}
				if (match >= 0) {
					used.add(match);
					const tr = trs[prevIds[match]];
					tr.b = k;
					tr.items.push(pl);
					ids.push(tr.id);
				} else {
					const tr: Track = {id: trs.length, a: k, b: k, items: [pl], newIdx: fresh++};
					trs.push(tr);
					ids.push(tr.id);
				}
			});
			prevIds = ids;
		});
		// phrase start times
		const n = p.phrases.length;
		let tm: number[];
		if (p.times.length >= n) tm = p.times.slice(0, n);
		else if (p.hold > 0) tm = Array.from({length: n}, (_, k) => p.times[k] ?? k * p.hold);
		else {
			const per = Math.max(0.2, (Ds - outro) / (n + 0.6));
			tm = Array.from({length: n}, (_, k) => p.times[k] ?? k * per);
		}
		for (let k = 1; k < tm.length; k++) tm[k] = Math.max(tm[k], tm[k - 1] + 0.05);
		return {tracks: trs, times: tm, phrases: n};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [JSON.stringify(p.phrases), JSON.stringify(p.times), JSON.stringify(p.images), JSON.stringify(p.small), p.hold, p.size, p.maxWidth, p.upper, p.fit, p.wrap, p.smallScale, p.imageSize, p.x, p.y, W, H, u, Ds, outro, font.family, font.weight, font.stretch, font2.family]);

	const phraseAt = (tt: number) => {
		let k = -1;
		for (let i = 0; i < times.length; i++) if (times[i] <= tt + 1e-6) k = i;
		return k;
	};

	// new words wait for removed ones to clear (no overlapping smears), otherwise follow right away
	const exitsInto = (k: number) => k > 0 && tracks.some((x2) => x2.b === k - 1);
	const enterStart = (tr: Track) => times[tr.a] + (tr.a === 0 ? 0 : exitsInto(tr.a) ? EXIT * 0.8 : LAG) + tr.newIdx * p.stagger;
	const enterMode = (tr: Track) => {
		const kind = tr.items[0].tok.kind;
		if (kind !== 'text') return 'grow';
		return tr.a === 0 ? p.intro : p.enter;
	};
	const exitMode = (tr: Track) => {
		const kind = tr.items[tr.items.length - 1].tok.kind;
		if (kind !== 'text') return 'shrink';
		if (p.exit === 'mix') return tr.b % 2 === 0 ? 'shrink' : 'slide';
		return p.exit;
	};
	const springAt = (dt: number) =>
		dt <= 0 ? 0 : spring({frame: dt * fps * sp, fps, config: {damping: 11, stiffness: 230, mass: 0.75}});

	/** Rest pose of a track after reaching phrase j (FLIP glide from the pose it had when phrase j started). */
	const restPose = (tr: Track, j: number, tt: number): Pose => {
		const target = tr.items[j - tr.a].pose;
		if (j <= tr.a) return target;
		const from = restPose(tr, j - 1, times[j]);
		const e = ease.outQuart(prog(tt, times[j] + 0.02, times[j] + 0.02 + GLIDE));
		return {x: lerp(from.x, target.x, e), y: lerp(from.y, target.y, e), s: lerp(from.s, target.s, e)};
	};

	type State = {x: number; y: number; S: number; o: number; j: number};
	const stateAt = (tr: Track, tt: number): State | null => {
		const k = phraseAt(tt);
		if (k < tr.a) return null;
		const t0 = enterStart(tr);
		if (tt < t0) return null;
		const j = Math.min(k, tr.b);
		const rest = restPose(tr, j, tt);
		let x = rest.x;
		let S = rest.s;
		let o = 1;
		// entrance
		const mode = enterMode(tr);
		if (mode === 'slide') {
			const e = ease.outExpo(prog(tt, t0, t0 + ENTER));
			x += DIST * (1 - e);
			o *= prog(tt, t0, t0 + 0.12 / sp);
		} else if (mode === 'grow') {
			const g = springAt(tt - t0);
			S *= Math.max(0, g);
			o *= clamp01(g * 5);
		} else {
			// starts huge and readable (visible from the first frame), then rushes down into place
			const e = ease.inOutCubic(prog(tt, t0, t0 + ZOOM_IN));
			S *= Math.pow(6, 1 - e);
			x += 0.22 * W * (1 - e);
		}
		// exit (removed in the next phrase, or the outro after the last one)
		let ep = 0;
		if (tr.b < phrases - 1) {
			const e0 = times[tr.b + 1];
			ep = prog(tt, e0, e0 + EXIT);
		} else if (outroP > 0) {
			const n = Math.max(1, tracks.filter((x2) => x2.b === phrases - 1).length);
			const idx = tracks.filter((x2) => x2.b === phrases - 1).indexOf(tr);
			ep = clamp01(outroP * (1 + 0.35) - (0.35 * idx) / n);
		}
		if (ep >= 1) return null;
		if (ep > 0) {
			if (exitMode(tr) === 'shrink') {
				S *= 1 - ease.inQuad(ep);
				o *= 1 - prog(ep, 0.65, 1);
			} else {
				x -= DIST * 0.85 * ease.inCubic(ep);
				o *= 1 - prog(ep, 0.4, 1);
			}
		}
		return {x, y: rest.y, S, o, j};
	};

	const blurs: MBlur[] = [];
	const nodes: React.ReactNode[] = [];
	const half = 0.5 / fps;
	for (const tr of tracks) {
		const st = stateAt(tr, t);
		if (!st || st.o <= 0.003 || st.S <= 0.002) continue;
		const pl = tr.items[st.j - tr.a];
		const tk = pl.tok;
		// velocity over half a frame (180° shutter); on the first visible frame look half a frame ahead instead
		const before = stateAt(tr, t - half);
		const after = before ? null : stateAt(tr, t + half);
		const prev = before ?? (after ? {...st, x: 2 * st.x - after.x, y: 2 * st.y - after.y, S: 2 * st.S - after.S} : st);
		const dx = st.x - prev.x;
		const dy = st.y - prev.y;
		const edge = Math.abs(st.S - prev.S) * Math.max(tk.w, tk.h) * 0.5;
		const maxStd = 80 * u * Math.max(0.5, p.blur);
		const iso = motionStd(edge, p.blur * 0.55, maxStd * 0.5);
		const local = Math.max(0.05, st.S);
		const lim = 2 * Math.max(tk.w, tk.h);
		const b: MBlur = {
			id: `tswap-mb-${tr.id}`,
			sx: Math.min(lim, (motionStd(dx, p.blur, maxStd) + iso) / local),
			sy: Math.min(lim, (motionStd(dy, p.blur, maxStd) + iso) / local),
			w: tk.w,
			h: tk.h,
		};
		blurs.push(b);
		// underline progress (accent runs draw once, retract when the word stops being an accent)
		let ul = 0;
		if (p.underline && tk.kind === 'text') {
			const j = st.j;
			if (tk.accent) {
				let r = j;
				while (r > tr.a && tr.items[r - 1 - tr.a].tok.accent) r--;
				const land = r === tr.a ? enterStart(tr) + (enterMode(tr) === 'zoom' ? ZOOM_IN * 0.75 : ENTER * 0.55) : times[r] + GLIDE * 0.5;
				ul = ease.outCubic(prog(t, land + 0.04, land + 0.04 + 0.36 / sp));
			} else if (j > tr.a && tr.items[j - 1 - tr.a].tok.accent) {
				ul = 1 - ease.inCubic(prog(t, times[j], times[j] + 0.18 / sp));
			}
		}
		const ulW = tk.w + pl.joinRight;
		// accent colour fades in/out when a word changes role
		const prevTok = st.j > tr.a ? tr.items[st.j - 1 - tr.a].tok : null;
		const roleMix = prevTok && prevTok.accent !== tk.accent ? ease.outCubic(prog(t, times[st.j], times[st.j] + GLIDE * 0.6)) : 1;
		const accentC = p.accentText ? theme.accent : theme.fg;
		const segColor = (accent: boolean) => {
			const now = accent ? accentC : theme.fg;
			if (roleMix >= 1 || !prevTok) return now;
			const before = prevTok.accent ? accentC : theme.fg;
			return mix(before, now, roleMix);
		};
		const shadow = p.shadow > 0 ? `0 ${4 * u}px ${18 * u}px rgba(0,0,0,${0.45 * p.shadow})` : undefined;
		let content: React.ReactNode;
		if (tk.kind === 'img') {
			content = (
				<Img
					src={assetSrc(tk.src)}
					style={{width: tk.w, height: tk.h, objectFit: 'contain', display: 'block', filter: p.shadow > 0 ? `drop-shadow(0 ${6 * u}px ${14 * u}px rgba(0,0,0,${0.35 * p.shadow}))` : undefined}}
				/>
			);
		} else if (tk.kind === 'emoji') {
			content = <span style={{fontFamily: EMOJI_STACK, fontSize: tk.fs, lineHeight: 1, display: 'block', whiteSpace: 'pre'}}>{tk.word.text}</span>;
		} else {
			content = (
				<div style={{...textStyle, fontSize: tk.fs, whiteSpace: 'pre', position: 'relative', textShadow: shadow}}>
					{ul > 0.001 ? (
						<div
							style={{
								position: 'absolute',
								left: -0.03 * tk.fs,
								top: 0.82 * tk.fs,
								width: (ulW + 0.06 * tk.fs) * ul,
								height: Math.max(3, 0.09 * tk.fs),
								borderRadius: 0.045 * tk.fs,
								background: rgba(theme.accent, 0.92),
								zIndex: 0,
							}}
						/>
					) : null}
					<span style={{position: 'relative', zIndex: 1}}>
						{tk.word.segs.map((s, i) => (
							<span
								key={i}
								style={{
									color: segColor(s.accent || s.em),
									...(s.em ? {...font2Css(font2), fontSize: '1.12em', letterSpacing: '-0.01em'} : {}),
								}}
							>
								{s.text}
							</span>
						))}
					</span>
				</div>
			);
		}
		nodes.push(
			<div
				key={tr.id}
				style={{
					position: 'absolute',
					left: st.x - tk.w / 2,
					top: st.y - tk.h / 2,
					width: tk.w,
					height: tk.h,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'flex-start',
					opacity: st.o,
					transform: `scale(${st.S})`,
					transformOrigin: '50% 50%',
					willChange: 'transform',
					...mblurStyle(b),
				}}
			>
				{content}
			</div>,
		);
	}

	return (
		<AbsoluteFill>
			<MBlurDefs blurs={blurs} />
			{nodes}
		</AbsoluteFill>
	);
};

export const textSwap = defineLook({
	id: 'text-swap',
	category: 'text',
	kind: 'overlay',
	duration: 3.3,
	outro: 0.3,
	customOutro: true,
	font: {weight: 700},
	description:
		'Kinetic sentence that changes phrase by phrase (FLIP): words shared with the previous phrase glide to their new place, removed words shrink away or slide out, new words slide in from the right with a horizontal motion blur; emoji / [[img:name]] tokens grow from a point with a springy overshoot. Optional zoom-in intro and a highlighter underline under **accent** words.',
	props,
	render: TextSwap,
});
