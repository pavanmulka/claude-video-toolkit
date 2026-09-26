#!/usr/bin/env node
// Visual verification helpers (one browser session per call). Outputs go to ../.work/motion/.
//   node scripts/verify.mjs strips  [ids...] [--count 6] [--size 1920x1080]   frame strips per look
//   node scripts/verify.mjs stills  [ids...] [--size WxH]                      mid-frame PNG per look (<id>.png)
//   node scripts/verify.mjs clips   [ids...] [--seconds 1.5]                   short renders + render_times.json
//   node scripts/verify.mjs catalog                                           catalog.png contact sheet of mid-frames
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderJobs} from '../render.mjs';

const MOTION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(MOTION, '..');
const WORK = path.join(REPO, '.work', 'motion');
// Demo logo: the first workspace brand's logo.png, if any (without one, looks fall back to their monogram)
const BRANDS = path.join(REPO, 'workspace', 'brand');
const LOGO = fs.existsSync(BRANDS)
	? fs.readdirSync(BRANDS).sort().map((b) => path.join(BRANDS, b, 'logo.png')).find((p) => fs.existsSync(p))
	: undefined;

const [mode = 'stills', ...rest] = process.argv.slice(2);
const ids = [];
const opt = {};
for (let i = 0; i < rest.length; i++) {
	if (rest[i].startsWith('--')) opt[rest[i].slice(2)] = rest[++i];
	else ids.push(rest[i]);
}
const {buildCatalog} = await import('./catalog.mjs');
const catalog = await buildCatalog({quiet: true});
const looks = ids.length ? ids.map((id) => catalog.find((l) => l.id === id) ?? (() => {
	throw new Error(`unknown look ${id}`);
})()) : catalog;

/** Demo props so every look shows real content (logo from your workspace brand). */
const demoProps = (look) => {
	const p = {};
	if (look.props.logo && LOGO) p.logo = LOGO;
	if (look.props.hubLogo && LOGO) p.hubLogo = LOGO;
	return p;
};

const sizeProps = () => {
	if (!opt.size) return {};
	const [width, height] = opt.size.split('x').map(Number);
	return {width, height};
};

const labelFont = [path.join(MOTION, 'public', 'fonts', 'Inter', 'Inter-SemiBold.otf'), '/System/Library/Fonts/Supplemental/Arial.ttf'].find((f) => fs.existsSync(f));

const montage = (files, labels, out, {cols, tileW, tileH, bg = '#15101c', point = 14}) => {
	const args = ['montage'];
	files.forEach((f, i) => args.push('-label', labels[i], f));
	args.push('-tile', `${cols}x`, '-geometry', `${tileW}x${tileH}+8+8`, '-background', bg, '-fill', '#d8d0e8', '-pointsize', String(point));
	if (labelFont) args.push('-font', labelFont);
	args.push(out.endsWith('.png') ? `PNG24:${out}` : out);
	execFileSync('magick', args);
};

const run = async () => {
	fs.mkdirSync(WORK, {recursive: true});
	const size = sizeProps();
	const suffix = opt.size ? `_${opt.size}` : '';
	if (mode === 'strips') {
		const count = parseInt(opt.count ?? '6', 10);
		const jobs = [];
		for (const look of looks) {
			const dur = look.default_duration;
			const n = Math.round(dur * 30);
			const frames = Array.from({length: count}, (_, i) => Math.min(n - 1, Math.round(((i + 0.5) * n) / count)));
			for (const f of frames) jobs.push({id: look.id, props: {...demoProps(look), ...size}, frame: f, out: path.join(WORK, 'sheets', 'tmp', `${look.id}${suffix}_${String(f).padStart(4, '0')}.png`)});
		}
		await renderJobs(jobs, {onResult: () => undefined});
		for (const look of looks) {
			const files = jobs.filter((j) => j.id === look.id).map((j) => j.out);
			const w = size.width ?? 1080;
			const h = size.height ?? 1920;
			const tileW = w >= h ? 420 : 240;
			montage(files, files.map((f) => `${(parseInt(path.basename(f).split('_').pop(), 10) / 30).toFixed(2)}s`), path.join(WORK, 'sheets', `${look.id}${suffix}.jpg`), {cols: Math.min(files.length, w >= h ? 3 : 6), tileW, tileH: Math.round((tileW * h) / w)});
			console.error(path.join(WORK, 'sheets', `${look.id}${suffix}.jpg`));
		}
		fs.rmSync(path.join(WORK, 'sheets', 'tmp'), {recursive: true, force: true});
		return;
	}
	if (mode === 'stills' || mode === 'catalog') {
		const jobs = looks.map((look) => ({id: look.id, props: {...demoProps(look), ...size}, frame: 'mid', out: path.join(WORK, `${look.id}${suffix}.png`)}));
		const results = [];
		await renderJobs(jobs, {onResult: (r) => results.push(r)});
		for (const r of results) console.error(`${r.id}: ${r.out} (frame ${r.frame}, ${r.render_seconds}s)`);
		if (mode === 'catalog') {
			const flat = path.join(WORK, 'catalog_tmp');
			fs.mkdirSync(flat, {recursive: true});
			const files = [];
			for (const r of results) {
				const f = path.join(flat, `${r.id}.png`);
				// composite overlays on the theme stage colour so transparent looks are visible
				execFileSync('magick', [r.out, '-background', '#0E0416', '-flatten', f]);
				files.push(f);
			}
			const labels = results.map((r) => {
				const l = catalog.find((c) => c.id === r.id);
				return `${r.id}  (${l.kind})`;
			});
			montage(files, labels, path.join(WORK, 'catalog.png'), {cols: 8, tileW: 216, tileH: 384, bg: '#1b1426', point: 13});
			fs.rmSync(flat, {recursive: true, force: true});
			console.error(path.join(WORK, 'catalog.png'));
		}
		return;
	}
	if (mode === 'clips') {
		const seconds = parseFloat(opt.seconds ?? '1.5');
		const jobs = looks.map((look) => ({id: look.id, props: {...demoProps(look), ...size, duration: seconds, delay: 0}, out: path.join(WORK, 'clips', `${look.id}${suffix}.mov`)}));
		const times = {};
		await renderJobs(jobs, {
			onResult: (r) => {
				times[r.id] = {frames: r.frames, render_seconds: r.render_seconds, fps_rendered: +(r.frames / r.render_seconds).toFixed(1), codec: r.codec};
				console.error(`${r.id}: ${r.frames} frames in ${r.render_seconds}s (${times[r.id].fps_rendered} fps) ${r.codec}`);
			},
		});
		const tf = path.join(WORK, `render_times${suffix}.json`);
		const prev = fs.existsSync(tf) ? JSON.parse(fs.readFileSync(tf, 'utf8')) : {};
		fs.writeFileSync(tf, JSON.stringify({...prev, ...times}, null, 1));
		console.error(tf);
		return;
	}
	throw new Error(`unknown mode ${mode}`);
};

run().catch((e) => {
	console.error(e.stack || e);
	process.exit(1);
});
