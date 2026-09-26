// Small UI building blocks shared by the storytelling looks (generic styling from the theme).
import React from 'react';
import {Img} from 'remotion';
import {mix, onColor, rgba} from './color';
import {EMOJI_STACK, fontCss} from './fonts';
import {assetSrc} from './look';
import type {FontProps, Theme} from './schema';

/** Round avatar: image, or initials on a gradient. */
export const Avatar: React.FC<{src?: string; name: string; size: number; theme: Theme; font: FontProps; ring?: boolean}> = ({src, name, size, theme, font, ring}) => {
	const url = src ? assetSrc(src) : '';
	const initials =
		name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase())
			.join('') || '•';
	return (
		<div
			style={{
				width: size,
				height: size,
				borderRadius: '50%',
				overflow: 'hidden',
				flexShrink: 0,
				background: `linear-gradient(135deg, ${theme.accent2}, ${mix(theme.accent2, theme.accent, 0.6)})`,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				boxShadow: ring ? `0 0 0 ${size * 0.05}px ${rgba('#FFFFFF', 0.9)}` : undefined,
			}}
		>
			{url ? (
				<Img src={url} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
			) : (
				<span style={{...fontCss(font, {weight: 800}), fontSize: size * 0.4, color: onColor(theme.accent2), letterSpacing: '-0.02em'}}>{initials}</span>
			)}
		</div>
	);
};

/** App icon tile: image, emoji, or a letter on a gradient squircle. */
export const AppIcon: React.FC<{src?: string; label: string; size: number; theme: Theme; font: FontProps}> = ({src, label, size, theme, font}) => {
	const isEmoji = src && !/[/.]/.test(src) && src.length <= 4;
	const url = src && !isEmoji ? assetSrc(src) : '';
	return (
		<div
			style={{
				width: size,
				height: size,
				borderRadius: size * 0.2237,
				overflow: 'hidden',
				flexShrink: 0,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				background: url ? 'transparent' : `linear-gradient(135deg, ${theme.accent2}, ${theme.accent})`,
				boxShadow: `inset 0 ${size * 0.02}px 0 rgba(255,255,255,0.3)`,
			}}
		>
			{url ? (
				<Img src={url} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
			) : isEmoji ? (
				<span style={{fontFamily: EMOJI_STACK, fontSize: size * 0.62, lineHeight: 1}}>{src}</span>
			) : (
				<span style={{...fontCss(font, {weight: 900}), fontSize: size * 0.52, color: onColor(theme.accent)}}>{(label.trim()[0] ?? '•').toUpperCase()}</span>
			)}
		</div>
	);
};

/** Frosted glass surface style (works over video; backdrop blur only applies when something is behind). */
export const glass = (u: number, theme: Theme, tone: 'dark' | 'light' = 'dark', radius = 40): React.CSSProperties =>
	tone === 'light'
		? {
				borderRadius: radius * u,
				background: `linear-gradient(180deg, ${rgba('#FFFFFF', 0.86)}, ${rgba('#F4F1FA', 0.8)})`,
				border: `${1.5 * u}px solid ${rgba('#FFFFFF', 0.7)}`,
				boxShadow: `0 ${20 * u}px ${50 * u}px rgba(0,0,0,0.28)`,
				backdropFilter: `blur(${30 * u}px) saturate(1.4)`,
				color: '#15121C',
			}
		: {
				borderRadius: radius * u,
				background: `linear-gradient(180deg, ${rgba(mix(theme.bg, '#FFFFFF', 0.16), 0.78)}, ${rgba(mix(theme.bg, '#FFFFFF', 0.08), 0.74)})`,
				border: `${1.5 * u}px solid ${rgba('#FFFFFF', 0.14)}`,
				boxShadow: `0 ${22 * u}px ${56 * u}px rgba(0,0,0,0.4), inset 0 ${1.5 * u}px 0 ${rgba('#FFFFFF', 0.12)}`,
				backdropFilter: `blur(${30 * u}px) saturate(1.3)`,
				color: theme.fg,
			};

/** Three bouncing dots (typing indicator). */
export const TypingDots: React.FC<{t: number; size: number; color: string}> = ({t, size, color}) => (
	<div style={{display: 'flex', gap: size * 0.55, alignItems: 'center', height: size * 1.6}}>
		{[0, 1, 2].map((k) => {
			const ph = Math.sin((t * 1.7 - k * 0.18) * Math.PI * 2);
			const lift = Math.max(0, ph);
			return <div key={k} style={{width: size, height: size, borderRadius: '50%', background: color, opacity: 0.45 + 0.55 * lift, transform: `translateY(${-lift * size * 0.45}px)`}} />;
		})}
	</div>
);

/** Grid row that grows from 0 to its content height (p: 0..1+, springs welcome). */
export const GrowRow: React.FC<{p: number; children: React.ReactNode; style?: React.CSSProperties}> = ({p, children, style}) => (
	<div style={{display: 'grid', gridTemplateRows: `${Math.max(0, p).toFixed(4)}fr`, ...style}}>
		<div style={{minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end'}}>{children}</div>
	</div>
);

/** Message-bubble tail at the bottom corner of a bubble (put inside the positioned bubble wrapper). */
export const Tail: React.FC<{side: 'left' | 'right'; color: string; size: number}> = ({side, color, size}) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 20 20"
		style={{position: 'absolute', bottom: 0, [side]: -size * 0.32, transform: side === 'right' ? 'scaleX(-1)' : undefined, overflow: 'visible'}}
	>
		<path d="M20 0 L20 20 L2 20 C 6 19 9.5 16.5 10.5 11 L 11 0 Z" fill={color} />
		<path d="M 0.5 20 C 5.5 20 9 17.5 10.5 13 L 13 20 Z" fill={color} />
	</svg>
);
