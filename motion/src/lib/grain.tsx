import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';

/** Deterministic LCG (fast, for texture generation). */
export const lcg = (seed: number) => {
	let s = seed >>> 0 || 1;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 4294967296;
	};
};

/** A grey noise tile as a data URL (generated once per page). */
export const useNoiseTile = (size = 256, seed = 7) =>
	useMemo(() => {
		const c = document.createElement('canvas');
		c.width = size;
		c.height = size;
		const ctx = c.getContext('2d');
		if (!ctx) return '';
		const img = ctx.createImageData(size, size);
		const r = lcg(seed);
		for (let i = 0; i < size * size; i++) {
			const v = Math.floor(r() * 256);
			img.data[i * 4] = v;
			img.data[i * 4 + 1] = v;
			img.data[i * 4 + 2] = v;
			img.data[i * 4 + 3] = 255;
		}
		ctx.putImageData(img, 0, 0);
		return c.toDataURL('image/png');
	}, [size, seed]);

/** Animated film grain (overlay blend). amount 0..1 (0.04-0.12 is subtle). */
export const Grain: React.FC<{amount: number; u: number; blend?: React.CSSProperties['mixBlendMode']; every?: number}> = ({amount, u, blend = 'overlay', every = 2}) => {
	const frame = useCurrentFrame();
	const tile = useNoiseTile();
	if (amount <= 0 || !tile) return null;
	const k = Math.floor(frame / every);
	const r = lcg(k * 7919 + 13);
	const size = 256 * Math.max(1, u);
	return (
		<AbsoluteFill
			style={{
				backgroundImage: `url(${tile})`,
				backgroundSize: `${size}px ${size}px`,
				backgroundPosition: `${Math.floor(r() * size)}px ${Math.floor(r() * size)}px`,
				opacity: amount,
				mixBlendMode: blend,
				pointerEvents: 'none',
			}}
		/>
	);
};
