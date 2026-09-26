// DOM text measurement (only call after fonts are ready - looks render nothing until then).
import type React from 'react';

const cache = new Map<string, {width: number; height: number}>();

let host: HTMLDivElement | null = null;
const getHost = () => {
	if (!host || !host.isConnected) {
		host = document.createElement('div');
		host.style.cssText = 'position:absolute;left:-100000px;top:-100000px;visibility:hidden;pointer-events:none;contain:layout style;';
		document.body.appendChild(host);
	}
	return host;
};

const applyStyle = (el: HTMLElement, style: React.CSSProperties) => {
	for (const [k, v] of Object.entries(style)) {
		if (v === undefined || v === null) continue;
		const val = typeof v === 'number' && !['fontWeight', 'lineHeight', 'opacity', 'zIndex', 'flex'].includes(k) ? `${v}px` : String(v);
		(el.style as unknown as Record<string, string>)[k] = val;
	}
};

/** Width/height of a single line of text (no wrapping). */
export const measureText = (text: string, style: React.CSSProperties) => {
	const key = `L|${text}|${JSON.stringify(style)}`;
	const hit = cache.get(key);
	if (hit) return hit;
	const el = document.createElement('span');
	el.style.whiteSpace = 'pre';
	el.style.display = 'inline-block';
	applyStyle(el, style);
	el.textContent = text;
	getHost().appendChild(el);
	const r = el.getBoundingClientRect();
	el.remove();
	const res = {width: r.width, height: r.height};
	cache.set(key, res);
	return res;
};

/** Size of a wrapped block of text (balanced wrapping, like the rendered looks). */
export const measureBlock = (text: string, style: React.CSSProperties, maxWidth: number) => {
	const key = `B|${text}|${maxWidth}|${JSON.stringify(style)}`;
	const hit = cache.get(key);
	if (hit) return hit;
	const el = document.createElement('div');
	el.style.width = 'max-content';
	el.style.maxWidth = `${maxWidth}px`;
	el.style.whiteSpace = 'pre-line';
	(el.style as unknown as Record<string, string>).textWrap = 'balance';
	applyStyle(el, style);
	el.textContent = text;
	getHost().appendChild(el);
	const r = el.getBoundingClientRect();
	el.remove();
	const res = {width: r.width, height: r.height};
	cache.set(key, res);
	return res;
};

/**
 * Largest font size <= base so that no single word is wider than maxWidth and the wrapped block
 * is at most maxHeight tall.
 */
export const fitFontSize = (opts: {
	text: string;
	style: React.CSSProperties; // font family/weight/stretch/letterSpacing/lineHeight (no fontSize)
	base: number;
	maxWidth: number;
	maxHeight?: number;
	min?: number;
}): number => {
	const {text, style, base, maxWidth} = opts;
	const words = text.split(/\s+/).filter(Boolean);
	let size = base;
	let widest = 0;
	for (const w of words) widest = Math.max(widest, measureText(w, {...style, fontSize: base}).width);
	if (widest > maxWidth) size = (base * maxWidth) / widest;
	if (opts.maxHeight) {
		for (let i = 0; i < 6; i++) {
			const h = measureBlock(text, {...style, fontSize: size}, maxWidth).height;
			if (h <= opts.maxHeight) break;
			size *= Math.max(0.6, Math.sqrt(opts.maxHeight / h) * 0.98);
		}
	}
	return Math.max(opts.min ?? 8, size);
};

/** Width of the widest explicit line (\n separated) at `size`. */
export const widestLine = (text: string, style: React.CSSProperties, size: number) =>
	Math.max(0, ...text.split('\n').map((l) => measureText(l, {...style, fontSize: size}).width));
