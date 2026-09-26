import React from 'react';
import {Img} from 'remotion';
import {onColor, rgba} from './color';
import {fontCss} from './fonts';
import {assetSrc} from './look';
import type {FontProps, Theme} from './schema';

/** Logo image (or a monogram tile when `src` is empty) clipped to an app-icon squircle / circle. */
export const Logo: React.FC<{
	src: string;
	name: string;
	size: number;
	shape: 'app' | 'circle' | 'none';
	theme: Theme;
	font: FontProps;
	children?: React.ReactNode; // overlays (shine) rendered inside the clip
	shadow?: boolean;
}> = ({src, name, size, shape, theme, font, children, shadow = true}) => {
	const radius = shape === 'circle' ? '50%' : shape === 'app' ? size * 0.2237 : 0;
	const url = assetSrc(src);
	const initial = (name.trim()[0] ?? '•').toUpperCase();
	return (
		<div
			style={{
				position: 'relative',
				width: size,
				height: size,
				borderRadius: radius,
				overflow: 'hidden',
				flexShrink: 0,
				boxShadow: shadow ? `0 ${size * 0.08}px ${size * 0.22}px rgba(0,0,0,0.45), 0 0 ${size * 0.35}px ${rgba(theme.glow, 0.35)}` : undefined,
				background: url ? 'transparent' : `linear-gradient(135deg, ${theme.accent2} 0%, ${theme.accent} 100%)`,
			}}
		>
			{url ? (
				<Img src={url} style={{width: '100%', height: '100%', objectFit: shape === 'none' ? 'contain' : 'cover', display: 'block'}} />
			) : (
				<div
					style={{
						...fontCss(font, {weight: 900}),
						width: '100%',
						height: '100%',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						fontSize: size * 0.56,
						color: onColor(theme.accent),
						letterSpacing: '-0.04em',
					}}
				>
					{initial}
				</div>
			)}
			{shape !== 'none' ? <div style={{position: 'absolute', inset: 0, borderRadius: radius, boxShadow: `inset 0 ${size * 0.012}px 0 rgba(255,255,255,0.25)`}} /> : null}
			{children}
		</div>
	);
};
