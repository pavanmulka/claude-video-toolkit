import React from 'react';
import {AbsoluteFill, Easing, useCurrentFrame} from 'remotion';
import {ease, prog, rnd} from '../lib/anim';
import {mix} from '../lib/color';
import {fontCss} from '../lib/fonts';
import {defineLook, useLook, type LookProps} from '../lib/look';
import {Blurred, MotionBlurDefs, motionBlur} from '../lib/motion-blur';
import {int, num, point, str} from '../lib/schema';

const props = {
	count: int(10, 'Number of tiles (corners first, then the long sides, then overlapping pairs)', 1, 24),
	word: str('Tap', 'Short word printed on every tile (empty = plain tiles)'),
	size: num(400, 'Tile width (design units)', 40, 1600),
	aspect: num(0.72, 'Tile height / width', 0.2, 3),
	radius: num(0.2, 'Corner radius as a fraction of the tile height', 0, 0.5),
	wordSize: num(0, 'Word size in design units; 0 = auto (40 % of the tile height)', 0, 800),
	color: str('', 'Tile colour (hex); empty = theme accent'),
	color2: str('', 'Lighter variant mixed in (paired / every few tiles); empty = `color` mixed 45 % with white'),
	textColor: str('', 'Word colour; empty = a darker shade of each tile colour'),
	opacity: num(1, 'Tile opacity', 0, 1),
	rotate: num(7, 'Max tile rotation in degrees', 0, 45),
	visible: num(0.5, 'Average share of each tile inside the frame (the rest hangs off the edge)', 0.15, 1),
	clear: point([0.6, 0.36], 'Centre zone kept clear [w, h] as fractions of the frame'),
	x: num(0.5, 'Centre x of the clear zone (fraction of width)', 0, 1),
	y: num(0.5, 'Centre y of the clear zone (fraction of height)', 0, 1),
	slide: num(0.32, 'Seconds each slide-in takes (expo ease)', 0.05, 3),
	stagger: num(0.05, 'Seconds between tiles sliding in', 0, 2),
	drift: num(1, 'Slow drift and sway once landed (0 = still)', 0, 5),
	blur: num(1, 'Motion blur on the slide-in and slide-out (0 = off)', 0, 4),
	seed: int(1, 'Random seed (another arrangement)', 0, 1e9),
};

type P = LookProps<typeof props>;

const EXIT = Easing.bezier(0.6, 0, 0.9, 0.35);

/** Anchor on the frame edge: a corner (nx, ny both set) or an edge point; `along` 0..1 along that edge. */
type Spot = {nx: number; ny: number; along: number; pair: boolean};

const spots = (n: number, portrait: boolean, square: boolean, seed: string): Spot[] => {
	const C = (nx: number, ny: number, pair = false): Spot => ({nx, ny, along: 0, pair});
	// long sides: left / right in portrait, top / bottom in landscape
	const L1: Spot = portrait ? {nx: -1, ny: 0, along: 0.5, pair: false} : {nx: 0, ny: -1, along: 0.5, pair: false};
	const L2: Spot = portrait ? {nx: 1, ny: 0, along: 0.5, pair: false} : {nx: 0, ny: 1, along: 0.5, pair: false};
	const S1: Spot = portrait ? {nx: 0, ny: -1, along: 0.5, pair: false} : {nx: -1, ny: 0, along: 0.5, pair: false};
	const S2: Spot = portrait ? {nx: 0, ny: 1, along: 0.5, pair: false} : {nx: 1, ny: 0, along: 0.5, pair: false};
	const list: Spot[] = [
		C(1, -1),
		C(-1, 1),
		C(-1, -1),
		C(1, 1),
		L1,
		L2,
		C(1, -1, true),
		C(-1, 1, true),
		{...L1, along: 0.3},
		{...L2, along: 0.7},
		C(-1, -1, true),
		C(1, 1, true),
		S1,
		S2,
		{...L1, along: 0.72},
		{...L2, along: 0.28},
	];
	if (square) {
		// square: all four edge midpoints before the extra pairs
		list.splice(6, 0, S1, S2);
		list.splice(list.indexOf(S1, 9), 1);
		list.splice(list.indexOf(S2, 9), 1);
	}
	for (let i = list.length; i < n; i++) {
		const side = Math.floor(rnd(`${seed}xs${i}`) * 4);
		list.push({nx: side === 0 ? -1 : side === 1 ? 1 : 0, ny: side === 2 ? -1 : side === 3 ? 1 : 0, along: rnd(`${seed}xa${i}`, 0.15, 0.85), pair: false});
	}
	return list.slice(0, n);
};

const StickerTiles: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, Ds, outro, theme, font, portrait, square} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const mb = motionBlur('sticker-tiles', u);
	const S = (k: string) => `st${p.seed}:${k}`;
	const tw = p.size * u;
	const th = tw * p.aspect;
	const c1 = p.color || theme.accent;
	const c2 = p.color2 || mix(c1, '#FFFFFF', 0.45);
	const fontSize = (p.wordSize > 0 ? p.wordSize * u : th * 0.4);
	const C = {x0: (p.x - p.clear[0] / 2) * W, x1: (p.x + p.clear[0] / 2) * W, y0: (p.y - p.clear[1] / 2) * H, y1: (p.y + p.clear[1] / 2) * H};
	const outS = Math.min(outro, Ds * 0.5);
	const exAt = (tt: number) => (outS > 0 ? prog(tt, Ds - outS, Ds - 1 / fps) : 0);
	const list = spots(p.count, portrait, square, S(''));
	const order = list.map((_, i) => i).sort((a, b) => rnd(S(`o${a}`)) - rnd(S(`o${b}`)));
	const rank = new Array<number>(list.length);
	order.forEach((ti, r) => (rank[ti] = r));

	const tiles = list.map((s, i) => {
		const vis = Math.min(0.95, p.visible * rnd(S(`v${i}`), 0.8, 1.2));
		const visY = Math.min(0.95, p.visible * rnd(S(`vy${i}`), 0.8, 1.25));
		// position: corners hang off both edges, edge tiles hang off one
		let x = s.nx === 0 ? s.along * W : s.nx < 0 ? -tw / 2 + vis * tw : W + tw / 2 - vis * tw;
		let y = s.ny === 0 ? s.along * H : s.ny < 0 ? -th / 2 + visY * th : H + th / 2 - visY * th;
		if (s.pair) {
			// a second tile overlapping its corner partner, shifted along the long side
			if (portrait) y += -s.ny * th * rnd(S(`ps${i}`), 0.62, 0.8);
			else x += -s.nx * tw * rnd(S(`ps${i}`), 0.55, 0.72);
			x += -s.nx * tw * rnd(S(`pi${i}`), -0.05, 0.1);
			y += -s.ny * th * rnd(S(`pj${i}`), -0.05, 0.1);
		}
		if (s.nx === 0) x += rnd(S(`ja${i}`), -0.06, 0.06) * W;
		if (s.ny === 0) y += rnd(S(`ja${i}`), -0.05, 0.05) * H;
		// push out of the clear zone along the outward direction
		const hit = () => x + tw / 2 > C.x0 && x - tw / 2 < C.x1 && y + th / 2 > C.y0 && y - th / 2 < C.y1;
		if (hit()) {
			if (s.nx < 0) x = Math.max(-tw / 2 + 0.2 * tw, C.x0 - tw / 2);
			else if (s.nx > 0) x = Math.min(W + tw / 2 - 0.2 * tw, C.x1 + tw / 2);
			if (hit()) {
				if (s.ny < 0) y = Math.max(-th / 2 + 0.2 * th, C.y0 - th / 2);
				else if (s.ny > 0) y = Math.min(H + th / 2 - 0.2 * th, C.y1 + th / 2);
			}
		}
		const len = Math.hypot(s.nx, s.ny) || 1;
		const dir: [number, number] = [s.nx / len, s.ny / len];
		const far = (tw + th) * 0.85 + 60 * u;
		const light = s.pair || rnd(S(`c${i}`)) < 0.25;
		const col = light ? c2 : c1;
		// the word sits a little toward the inside of the frame (it may still be cut by the edge)
		const toC: [number, number] = [-dir[0], -dir[1]];
		return {i, x, y, dir, far, col, pair: s.pair, rot: rnd(S(`r${i}`), -p.rotate, p.rotate), start: 0.02 + rank[i] * p.stagger, exitAt: ((list.length - 1 - rank[i]) / Math.max(1, list.length - 1)) * 0.3, toC};
	});

	const pose = (tile: (typeof tiles)[number], tt: number) => {
		const e = ease.outExpo(prog(tt, tile.start, tile.start + p.slide));
		const x = EXIT(prog(exAt(tt), tile.exitAt, tile.exitAt + 0.7));
		const k = 1 - e + x;
		const A = p.drift * 12 * u;
		const dx = A * Math.sin((2 * Math.PI * tt) / rnd(S(`dp${tile.i}`), 3.5, 5.5) + rnd(S(`df${tile.i}`), 0, 6.28));
		const dy = A * Math.sin((2 * Math.PI * tt) / rnd(S(`dq${tile.i}`), 4, 6.5) + rnd(S(`dg${tile.i}`), 0, 6.28));
		return {
			x: tile.x + tile.dir[0] * tile.far * k + dx,
			y: tile.y + tile.dir[1] * tile.far * k + dy,
			rot: tile.rot + (1 - e) * 10 * (tile.dir[0] - tile.dir[1]) + p.drift * 1.2 * Math.sin((2 * Math.PI * tt) / rnd(S(`dr${tile.i}`), 4.5, 7) + rnd(S(`dh${tile.i}`), 0, 6.28)),
			started: tt >= tile.start,
		};
	};

	const box = Math.hypot(tw, th) * 1.08;
	return (
		<AbsoluteFill>
			<MotionBlurDefs mb={mb} />
			{[...tiles]
				.sort((a, b) => Number(b.pair) - Number(a.pair))
				.map((tile) => {
					const now = pose(tile, t);
					if (!now.started) return null;
					const prev = pose(tile, t - 1 / fps);
					if (now.x < -box || now.x > W + box || now.y < -box || now.y > H + box) return null;
					const ink = p.textColor || mix(tile.col, '#000000', 0.48);
					return (
						<Blurred key={tile.i} mb={mb} x={now.x} y={now.y} box={box} dx={now.x - prev.x} dy={now.y - prev.y} strength={p.blur} maxFrac={0.6}>
							<div
								style={{
									position: 'relative',
									width: tw,
									height: th,
									borderRadius: th * p.radius,
									background: tile.col,
									opacity: p.opacity,
									transform: `rotate(${now.rot.toFixed(2)}deg)`,
									overflow: 'hidden',
								}}
							>
								{p.word ? (
									<div
										style={{
											position: 'absolute',
											left: tw / 2 + tile.toC[0] * tw * 0.16,
											top: th / 2 + tile.toC[1] * th * 0.14,
											transform: 'translate(-50%, -50%)',
											...fontCss(font),
											fontSize,
											lineHeight: 1,
											letterSpacing: '-0.01em',
											color: ink,
											whiteSpace: 'nowrap',
										}}
									>
										{p.word}
									</div>
								) : null}
							</div>
						</Blurred>
					);
				})}
		</AbsoluteFill>
	);
};

export const stickerTiles = defineLook({
	id: 'sticker-tiles',
	category: 'fx',
	kind: 'overlay',
	duration: 3,
	outro: 0.35,
	customOutro: true,
	usesFont2: false,
	font: {weight: 600},
	description:
		'Big rounded accent tiles carrying a short word ("Tap", "Buy", "Save") slide in fast from outside the frame (motion blur), hang off the edges and corners, overlap in pairs, slightly rotated, drift slowly and slide back out; the centre stays clear for the stat or text.',
	props,
	render: StickerTiles,
});
