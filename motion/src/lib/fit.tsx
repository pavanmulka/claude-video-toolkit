import React, {useLayoutEffect, useRef, useState} from 'react';

/**
 * Scales its content down (never up) so its layout box fits maxWidth x maxHeight.
 * Content should keep a stable layout over time (animate with opacity/transform, not by mounting).
 */
export const FitBox: React.FC<{maxWidth: number; maxHeight: number; children: React.ReactNode; style?: React.CSSProperties}> = ({maxWidth, maxHeight, children, style}) => {
	const ref = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState<number | null>(null);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const w = el.offsetWidth;
		const h = el.offsetHeight;
		const s = Math.min(1, maxWidth / Math.max(1, w), maxHeight / Math.max(1, h));
		setScale((prev) => (prev === null || Math.abs(prev - s) > 0.001 ? s : prev));
	}, [maxWidth, maxHeight, children]);
	return (
		<div ref={ref} style={{transform: `scale(${scale ?? 1})`, transformOrigin: 'center center', visibility: scale === null ? 'hidden' : 'visible', ...style}}>
			{children}
		</div>
	);
};
