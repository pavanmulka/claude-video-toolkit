import React from 'react';
import {AbsoluteFill, Img, useCurrentFrame} from 'remotion';
import {SPRINGS, clamp01, lerp, rnd, sp} from '../lib/anim';
import {liftShadow, rgba} from '../lib/color';
import {assetSrc, defineLook, useLook, useT, type LookProps} from '../lib/look';
import {int, num, strList} from '../lib/schema';

const props = {
	columns: int(5, 'Number of card columns', 1, 10),
	speed: num(90, 'Scroll speed (design units per second); columns alternate up / down', 0, 2000),
	cardWidth: num(0.21, 'Card width as a fraction of the frame width', 0.05, 1),
	aspect: num(1.25, 'Card height / width', 0.3, 3),
	gap: num(26, 'Gap between cards (design units)', 0, 200),
	radius: num(24, 'Card corner radius (design units)', 0, 200),
	colors: strList(['#FF6A2B', '#1FC6B6', '#F6C445', '#16121C', '#2F7BFF', '#FF4F8B'], 'Icon tile colours (cycled)'),
	images: strList([], 'Optional card images (screenshots, posters...) used instead of the generated ad cards'),
	zoomFrom: num(1, 'Wall zoom at the start (e.g. 2.4 = start close on a few cards)', 0.2, 6),
	zoomTo: num(1, 'Wall zoom at the end (1 = fill the frame)', 0.2, 6),
	stagger: num(0.012, 'Seconds between cards popping in', 0, 0.5),
	tilt: num(0, 'Wall tilt in degrees (3D lean back)', -60, 60),
};

type P = LookProps<typeof props>;

const shapes = ['circle', 'triangle', 'plus', 'square'] as const;

const Card: React.FC<{p: P; i: number; w: number; h: number}> = ({p, i, w, h}) => {
	const {u} = useLook();
	const col = p.colors[i % p.colors.length];
	const shape = shapes[Math.floor(rnd(`s${i}`) * shapes.length)];
	const img = p.images.length ? p.images[i % p.images.length] : '';
	const iconS = w * 0.34;
	return (
		<div style={{width: w, height: h, borderRadius: p.radius * u, background: '#FFFFFF', boxShadow: liftShadow(u, 0.18), overflow: 'hidden', position: 'relative'}}>
			{img ? (
				<Img src={assetSrc(img)} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
			) : (
				<>
					<div style={{position: 'absolute', left: w * 0.1, top: w * 0.1, width: w * 0.8, height: h * 0.52, borderRadius: p.radius * u * 0.7, background: col, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
						{shape === 'circle' ? <div style={{width: iconS, height: iconS, borderRadius: '50%', border: `${iconS * 0.16}px solid #FFFFFF`}} /> : null}
						{shape === 'square' ? <div style={{width: iconS * 0.8, height: iconS * 0.8, borderRadius: iconS * 0.12, background: '#FFFFFF'}} /> : null}
						{shape === 'triangle' ? <div style={{width: 0, height: 0, borderLeft: `${iconS * 0.5}px solid transparent`, borderRight: `${iconS * 0.5}px solid transparent`, borderBottom: `${iconS * 0.85}px solid #FFFFFF`}} /> : null}
						{shape === 'plus' ? <div style={{position: 'relative', width: iconS, height: iconS}}><div style={{position: 'absolute', left: '38%', top: 0, width: '24%', height: '100%', background: '#FFFFFF', borderRadius: 4 * u}} /><div style={{position: 'absolute', top: '38%', left: 0, height: '24%', width: '100%', background: '#FFFFFF', borderRadius: 4 * u}} /></div> : null}
					</div>
					{[0, 1, 2].map((k) => (
						<div key={k} style={{position: 'absolute', left: w * 0.1, top: h * (0.68 + k * 0.1), width: w * (k === 2 ? 0.45 : 0.8 - k * 0.15), height: h * 0.045, borderRadius: h, background: k === 0 ? rgba('#16121C', 0.75) : rgba(col, 0.55)}} />
					))}
				</>
			)}
		</div>
	);
};

const CardWall: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, Ds} = useLook();
	const frame = useCurrentFrame();
	const t = useT();
	const zoom = lerp(p.zoomFrom, p.zoomTo, clamp01(sp(frame, fps, 0.2, SPRINGS.gentle, Math.round(Math.max(0.5, Ds - 0.3) * fps))));
	const cw = p.cardWidth * W;
	const ch = cw * p.aspect;
	const gap = p.gap * u;
	const pitch = ch + gap;
	const colW = cw + gap;
	const total = p.columns * colW - gap;
	const rows = Math.ceil(H / (pitch * Math.min(1, zoom)) / 1) + 4;
	return (
		<AbsoluteFill style={{perspective: 1600 * u}}>
			<div style={{position: 'absolute', left: (W - total) / 2, top: 0, width: total, height: H, transform: `scale(${zoom}) rotateX(${p.tilt}deg)`, transformOrigin: '50% 50%'}}>
				{Array.from({length: p.columns}, (_, c) => {
					const dir = c % 2 ? 1 : -1;
					const off = (((t * p.speed * u * dir) % pitch) + pitch) % pitch;
					return (
						<div key={c} style={{position: 'absolute', left: c * colW, top: -pitch * 2 + off - (c % 2 ? pitch / 2 : 0), width: cw}}>
							{Array.from({length: rows + 4}, (_, r) => {
								const i = c * 97 + r;
								const pop = clamp01(sp(frame, fps, (c + r * p.columns) * p.stagger, SPRINGS.pop));
								return (
									<div key={r} style={{marginBottom: gap, transform: `scale(${0.6 + 0.4 * pop})`, opacity: pop}}>
										<Card p={p} i={i} w={cw} h={ch} />
									</div>
								);
							})}
						</div>
					);
				})}
			</div>
		</AbsoluteFill>
	);
};

export const cardWall = defineLook({
	id: 'card-wall',
	category: 'ui',
	kind: 'overlay',
	duration: 5,
	outro: 0.3,
	usesFont2: false,
	description: 'An endless wall of cards in columns scrolling in opposite directions ("100s of ads every day", "every record in one place"): generated icon cards or your own images (screenshots), pop-in stagger, zoom-out from a few cards to the whole wall, optional 3D tilt.',
	props,
	render: CardWall,
});
