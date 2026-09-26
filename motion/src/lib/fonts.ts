// Brand fonts: render.mjs (--sync-fonts) copies ../brand/fonts into public/fonts and writes
// public/fonts/manifest.json ({families: {"TikTok Sans": [{file, weight, style, stretch}]}}).
// loadBrandFont() registers the best matching face with @remotion/fonts. Families that are not in
// the manifest are treated as installed system fonts and used by name.
import {loadFont} from '@remotion/fonts';
import type React from 'react';
import {useEffect, useState} from 'react';
import {cancelRender, continueRender, delayRender, staticFile} from 'remotion';
import type {Font2Props, FontProps} from './schema';

type Face = {
	file: string;
	weight: string; // "700" or "300 900"
	style: 'normal' | 'italic';
	stretch?: string; // "75% 150%"
	wmin: number;
	wmax: number;
};
type Manifest = {families: Record<string, Face[]>};

let manifestPromise: Promise<Manifest> | null = null;
const getManifest = (): Promise<Manifest> => {
	if (!manifestPromise) {
		manifestPromise = fetch(staticFile('fonts/manifest.json'))
			.then((r) => (r.ok ? (r.json() as Promise<Manifest>) : {families: {}}))
			.catch(() => ({families: {}}));
	}
	return manifestPromise;
};

const pickFace = (faces: Face[], weight: number, style: 'normal' | 'italic'): Face | null => {
	const sameStyle = faces.filter((f) => f.style === style);
	const pool = sameStyle.length ? sameStyle : faces;
	if (!pool.length) return null;
	const covering = pool.find((f) => f.wmin <= weight && weight <= f.wmax && f.wmin !== f.wmax);
	if (covering) return covering;
	return [...pool].sort((a, b) => {
		const da = Math.min(Math.abs(a.wmin - weight), Math.abs(a.wmax - weight));
		const db = Math.min(Math.abs(b.wmin - weight), Math.abs(b.wmax - weight));
		return da - db || b.wmax - a.wmax;
	})[0];
};

const registered = new Map<string, Promise<void>>();

/** Loads `family` at `weight`/`style` from brand fonts. Resolves false for non-brand (system) families. */
export const loadBrandFont = async (family: string, weight = 400, style: 'normal' | 'italic' = 'normal'): Promise<boolean> => {
	const manifest = await getManifest();
	const key = Object.keys(manifest.families).find((k) => k.toLowerCase() === family.trim().toLowerCase());
	if (!key) {
		// Installed system font (e.g. Georgia, Didot, Apple Color Emoji): ask the browser to load it.
		try {
			await document.fonts.load(`${style} ${weight} 48px "${family}"`);
		} catch {
			// ignore: the CSS fallback stack takes over
		}
		return false;
	}
	const face = pickFace(manifest.families[key], weight, style);
	if (!face) return false;
	if (!registered.has(face.file)) {
		registered.set(
			face.file,
			loadFont({
				family: key,
				url: staticFile(`fonts/${face.file}`),
				weight: face.weight,
				style: face.style,
				stretch: face.stretch,
			}),
		);
	}
	await registered.get(face.file);
	return true;
};

export type FontRequest = {family: string; weight: number; style?: 'normal' | 'italic'};

/** Blocks rendering (delayRender) until every requested font is loaded; returns true when ready. */
export const useFontsReady = (requests: FontRequest[]): boolean => {
	const key = JSON.stringify(requests);
	const [handle] = useState(() => delayRender(`Loading fonts ${key}`, {timeoutInMilliseconds: 60000}));
	const [ready, setReady] = useState(false);
	useEffect(() => {
		let alive = true;
		const reqs = JSON.parse(key) as FontRequest[];
		Promise.all(reqs.map((r) => loadBrandFont(r.family, r.weight, r.style ?? 'normal')))
			.then(() => document.fonts.ready)
			.then(() => {
				if (!alive) return;
				setReady(true);
				continueRender(handle);
			})
			.catch((err) => cancelRender(err));
		return () => {
			alive = false;
		};
	}, [key, handle]);
	return ready;
};

const SANS_FALLBACK = '"TikTok Sans", "Inter", "Helvetica Neue", Arial, sans-serif';
const SERIF_FALLBACK = '"Instrument Serif", "Didot", "Bodoni 72", "Georgia", serif';
export const EMOJI_STACK = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

const quote = (family: string) => `"${family.replace(/"/g, '')}"`;

export const sansStack = (family: string) => `${quote(family)}, ${SANS_FALLBACK}, ${EMOJI_STACK}`;
export const serifStack = (family: string) => `${quote(family)}, ${SERIF_FALLBACK}, ${EMOJI_STACK}`;

/** CSS for the primary font. `weight`/`stretch` override the prop values (e.g. a lighter label). */
export const fontCss = (f: FontProps, over: {weight?: number; stretch?: number} = {}): React.CSSProperties => {
	const stretch = over.stretch ?? f.stretch;
	return {
		fontFamily: sansStack(f.family),
		fontWeight: over.weight ?? f.weight,
		fontStretch: stretch && stretch !== 100 ? `${stretch}%` : undefined,
		fontKerning: 'normal',
		fontOpticalSizing: 'auto',
	};
};

export const font2Css = (f: Font2Props, over: {weight?: number} = {}): React.CSSProperties => ({
	fontFamily: serifStack(f.family),
	fontWeight: over.weight ?? f.weight,
	fontStyle: f.style,
	fontKerning: 'normal',
});

/** Font requests for the common props (primary at the prop weight + extras). */
export const fontRequests = (font: FontProps, font2: Font2Props | null, extraWeights: number[] = []): FontRequest[] => {
	const reqs: FontRequest[] = [{family: font.family, weight: font.weight}];
	for (const w of extraWeights) reqs.push({family: font.family, weight: w});
	if (font2) reqs.push({family: font2.family, weight: font2.weight, style: font2.style});
	return reqs;
};
