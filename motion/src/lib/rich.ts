// Tiny markup used by every text prop (same as the Python specs):
//   **word**  -> accent colour        *word* -> secondary font (italic)        \n -> new line
export type Seg = {text: string; accent: boolean; em: boolean};
export type Word = {
	segs: Seg[];
	text: string;
	accent: boolean; // any part accented
	em: boolean; // any part in font2
	span: number; // id of the **...** / *...* run the word belongs to (-1 = none)
	index: number; // word index over the whole text
	line: number; // explicit line (from \n)
	charStart: number; // index of the first visible char over the whole text
};
export type Rich = {lines: Word[][]; words: Word[]; plain: string; chars: number};

export const normalizeText = (s: string) => s.replace(/\\n/g, '\n').replace(/\r\n?/g, '\n');

export const parseRich = (input: string, opts: {upper?: boolean} = {}): Rich => {
	const s = normalizeText(input ?? '');
	type C = {ch: string; accent: boolean; em: boolean; span: number};
	const chars: C[] = [];
	let accent = false;
	let em = false;
	let span = -1;
	let spanCounter = 0;
	for (let i = 0; i < s.length; i++) {
		if (s[i] === '*' && s[i + 1] === '*') {
			accent = !accent;
			if (accent) span = spanCounter++;
			else if (!em) span = -1;
			i++;
			continue;
		}
		if (s[i] === '*') {
			em = !em;
			if (em) span = spanCounter++;
			else if (!accent) span = -1;
			continue;
		}
		const ch = opts.upper ? s[i].toLocaleUpperCase() : s[i];
		chars.push({ch, accent, em, span: accent || em ? span : -1});
	}
	const lines: Word[][] = [[]];
	const words: Word[] = [];
	let cur: C[] = [];
	let line = 0;
	let visible = 0;
	const flush = () => {
		if (!cur.length) return;
		const segs: Seg[] = [];
		for (const c of cur) {
			const last = segs[segs.length - 1];
			if (last && last.accent === c.accent && last.em === c.em) last.text += c.ch;
			else segs.push({text: c.ch, accent: c.accent, em: c.em});
		}
		const text = cur.map((c) => c.ch).join('');
		const w: Word = {
			segs,
			text,
			accent: cur.some((c) => c.accent),
			em: cur.some((c) => c.em),
			span: cur.find((c) => c.span >= 0)?.span ?? -1,
			index: words.length,
			line,
			charStart: visible,
		};
		visible += text.length;
		words.push(w);
		lines[lines.length - 1].push(w);
		cur = [];
	};
	for (const c of chars) {
		if (c.ch === '\n') {
			flush();
			lines.push([]);
			line++;
		} else if (/\s/.test(c.ch)) {
			flush();
		} else {
			cur.push(c);
		}
	}
	flush();
	const nonEmpty = lines.filter((l) => l.length);
	return {lines: nonEmpty.length ? nonEmpty : [[]], words, plain: nonEmpty.map((l) => l.map((w) => w.text).join(' ')).join('\n'), chars: visible};
};

/** Plain text with markup removed (for measuring). */
export const stripMarkup = (s: string) => normalizeText(s).replace(/\*\*/g, '').replace(/\*/g, '');
