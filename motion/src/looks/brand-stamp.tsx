import React from 'react';
import {AbsoluteFill, Img, useCurrentFrame} from 'remotion';
import {clamp01, ease, prog, rnd} from '../lib/anim';
import {fontCss} from '../lib/fonts';
import {assetSrc, defineLook, useLook, type LookProps} from '../lib/look';
import {asset, bool, int, num, oneOf, str} from '../lib/schema';

const props = {
	text: str('a mybrand film • made in-house •', 'Text set around the ring (reads clockwise; end with a separator such as • so it loops cleanly)'),
	center: oneOf(['logo', 'text', 'none'] as const, 'logo', 'What sits inside the ring: the logo, `centerText`, or nothing (the picture shows through)'),
	centerText: str('', 'Text inside the ring when center = text (e.g. a short brand name; \\n for two lines)'),
	logo: asset('Logo image for the centre (the brand logo is passed in automatically)'),
	logoInk: bool(false, 'Print the logo in the stamp ink (a one-colour silhouette, worn like the ink) instead of crisp in its own colours'),
	logoScale: num(1, 'Logo size relative to the space inside the inner ring', 0.2, 1.6),
	logoShape: oneOf(['circle', 'contain'] as const, 'circle', 'circle = the logo is cropped to a disc that fills the inner ring (app icons, square logos); contain = the whole image as it is'),
	logoZoom: num(1.08, 'circle shape: how far the logo image is zoomed inside its disc (crops a square icon\'s margins)', 0.5, 3),
	ink2: str('', 'Colour of the thick inner ring (hex); empty = the ink colour'),
	size: num(430, 'Stamp diameter (design units)', 60, 1800),
	x: num(0.5, 'Centre x (fraction of width)', -0.5, 1.5),
	y: num(0.72, 'Centre y (fraction of height)', -0.5, 1.5),
	rotate: num(-12, 'Final rotation in degrees', -180, 180),
	ink: str('', 'Ink colour (hex); empty = theme fg (dark on light stages, light on dark ones)'),
	edge: str('', 'Thin contrasting edge under the ink for busy pictures (hex, e.g. #000000 under white ink); empty = none'),
	wear: num(1, 'How worn the rubber stamp looks: speckles and broken edges (0 = clean vector)', 0, 3),
	at: num(0.32, 'Seconds at which the stamp lands (the slam starts at 0)', 0.05, 30),
	from: num(2.8, 'Scale it zooms down from', 1, 8),
	textSize: num(0, 'Ring text size in design units; 0 = auto from the diameter', 0, 300),
	spacing: num(0.12, 'Letter spacing of the ring text (em)', -0.1, 1),
	seed: int(3, 'Random seed for the wear pattern', 0, 1e6),
};

type P = LookProps<typeof props>;

// A rubber stamp seal: ring text on a circle, a thick broken inner ring, a thin outer ring, a centre mark; the ink is
// worn with turbulence speckles and slightly displaced edges. Animation: it zooms down out of the camera (motion
// blurred, fading in), lands at `at` with a squash, a little ink spread and a micro shake, then sits still.
const BrandStamp: React.FC<{p: P}> = ({p}) => {
	const {W, H, u, fps, theme, font} = useLook();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const ink = p.ink || theme.fg;
	const D = p.size * u;
	const R = 500; // local units: the stamp is drawn in a 1000 x 1000 box

	// zoom down, land, squash
	const fall = prog(t, 0, p.at, ease.inQuad);
	const after = t - p.at;
	const squash = after > 0 ? Math.exp(-after * 14) * Math.sin(after * 40) * 0.05 : 0;
	const scale = (p.from + (1 - p.from) * fall) * (1 - squash);
	const blur = after < 0 ? (1 - fall) * 10 * u : 0;
	const opacity = after < 0 ? clamp01(fall * 1.6) * 0.9 : 0.92;
	const spread = after > 0 ? Math.exp(-after * 9) * 3 : 0; // ink squeezes out a bit on impact
	const shake = after > 0 && after < 0.25 ? (rnd(`${p.seed}:${frame}`, -1, 1) * 4 * u * (1 - after / 0.25)) : 0;
	const rot = p.rotate + (1 - fall) * 18;

	const ts = p.textSize > 0 ? (p.textSize / p.size) * 1000 : 92;
	const textR = R - 58 - ts * 0.36;
	const circ = 2 * Math.PI * textR;
	const id = `bs${p.seed}`;
	const w = p.wear;

	const ringText = (
		<text
			fill={ink}
			style={{...fontCss(font), fontSize: ts, letterSpacing: `${p.spacing}em`, textTransform: 'none'}}
			dominantBaseline="middle"
		>
			<textPath href={`#${id}-path`} startOffset="0" textLength={circ * 0.985} lengthAdjust="spacing">
				{p.text}
			</textPath>
		</text>
	);

	const centerR = textR - ts * 0.62 - 18;
	const disc = (centerR - 34 - 3 - 10) * 2 * p.logoScale; // fills the thin inner ring with a hairline gap
	const lw = p.logoShape === 'circle' ? disc : centerR * 1.24 * p.logoScale;
	const logoEl = p.logo ? (
		<foreignObject x={R - lw / 2} y={R - lw / 2} width={lw} height={lw}>
			{p.logoShape === 'circle' ? (
				<div style={{width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden', position: 'relative'}}>
					<Img
						src={assetSrc(p.logo)}
						style={{
							position: 'absolute',
							width: `${p.logoZoom * 100}%`,
							height: `${p.logoZoom * 100}%`,
							left: `${(1 - p.logoZoom) * 50}%`,
							top: `${(1 - p.logoZoom) * 50}%`,
							objectFit: 'cover',
							filter: p.logoInk ? 'brightness(0)' : undefined,
						}}
					/>
				</div>
			) : (
				<Img src={assetSrc(p.logo)} style={{width: '100%', height: '100%', objectFit: 'contain', filter: p.logoInk ? 'brightness(0)' : undefined}} />
			)}
		</foreignObject>
	) : null;
	const inner = (
		<g>
			{/* thick inner ring, broken in two places like a real worn stamp */}
			<circle cx={R} cy={R} r={centerR} fill="none" stroke={p.ink2 || ink} strokeWidth={34 + spread * 4}
				strokeDasharray={`${centerR * 2.6} ${centerR * 0.16} ${centerR * 3.2} ${centerR * 0.26}`} />
			<circle cx={R} cy={R} r={centerR - 34} fill="none" stroke={ink} strokeWidth={6} />
			{p.center === 'logo' && p.logo && p.logoInk ? logoEl : null}
			{p.center === 'text' && p.centerText ? (
				<text x={R} y={R} fill={ink} textAnchor="middle" dominantBaseline="middle"
					style={{...fontCss(font), fontSize: centerR * 0.33, letterSpacing: "0.01em"}}>
					{p.centerText.split('\n').map((l, i, a) => (
						<tspan key={i} x={R} dy={i === 0 ? `${-(a.length - 1) * 0.55}em` : '1.1em'}>{l}</tspan>
					))}
				</text>
			) : null}
		</g>
	);

	return (
		<AbsoluteFill style={{opacity}}>
			<svg
				width={D}
				height={D}
				viewBox="0 0 1000 1000"
				style={{
					position: 'absolute',
					left: p.x * W - D / 2 + shake,
					top: p.y * H - D / 2 - shake * 0.6,
					overflow: 'visible',
					transform: `rotate(${rot}deg) scale(${scale})`,
					filter: blur > 0.3 ? `blur(${blur}px)` : undefined,
				}}
			>
				<defs>
					<path id={`${id}-path`} d={`M ${R} ${R} m ${-textR} 0 a ${textR} ${textR} 0 1 1 ${2 * textR} 0 a ${textR} ${textR} 0 1 1 ${-2 * textR} 0`} />
					<filter id={`${id}-wear`} x="-10%" y="-10%" width="120%" height="120%">
						{/* rough edges */}
						<feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed={p.seed} result="edgeNoise" />
						<feDisplacementMap in="SourceGraphic" in2="edgeNoise" scale={4 * w} xChannelSelector="R" yChannelSelector="G" result="rough" />
						{/* fine speckles + a few bigger blotches where the rubber didn't touch */}
						<feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed={p.seed + 7} result="fine" />
						<feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed={p.seed + 13} result="blot" />
						<feColorMatrix in="fine" type="matrix" values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${-24 * w} ${1 + 24 * w * 0.64}`} result="fineHoles" />
						<feColorMatrix in="blot" type="matrix" values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${-14 * w} ${1 + 14 * w * 0.7}`} result="blotHoles" />
						<feComposite in="fineHoles" in2="blotHoles" operator="in" result="keep" />
						<feComposite in="rough" in2="keep" operator="in" />
					</filter>
					{p.edge ? (
						<filter id={`${id}-edge`} x="-10%" y="-10%" width="120%" height="120%">
							<feMorphology in="SourceAlpha" operator="dilate" radius="3" result="d" />
							<feFlood floodColor={p.edge} floodOpacity="0.55" />
							<feComposite in2="d" operator="in" result="e" />
							<feMerge>
								<feMergeNode in="e" />
								<feMergeNode in="SourceGraphic" />
							</feMerge>
						</filter>
					) : null}
				</defs>
				<g filter={p.edge ? `url(#${id}-edge)` : undefined}>
					<g filter={w > 0 ? `url(#${id}-wear)` : undefined}>
						<circle cx={R} cy={R} r={R - 22} fill="none" stroke={ink} strokeWidth={14 + spread * 3} />
						{ringText}
						{inner}
					</g>
					{/* a crisp, full-colour logo sits in the middle, untouched by the worn ink */}
					{p.center === 'logo' && p.logo && !p.logoInk ? logoEl : null}
				</g>
			</svg>
		</AbsoluteFill>
	);
};

export const brandStamp = defineLook({
	id: 'brand-stamp',
	category: 'brand',
	kind: 'overlay',
	duration: 2.5,
	outro: 0,
	usesFont2: false,
	description:
		'A rubber-stamp seal (ring text, broken inner ring, logo or text in the middle, worn ink) that zooms down out of the camera and slams onto the last frame, like a director\'s signature stamp at the end of a film. Reuse it as the sign-off of every video.',
	props,
	render: BrandStamp,
});

