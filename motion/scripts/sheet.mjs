#!/usr/bin/env node
// Frame strip of one look for quick visual checks (dev tool).
//   node scripts/sheet.mjs <id> [--props '{"text":"HI"}'|file.json] [--frames 3,8,15,30|--count 10]
//                               [--size 1920x1080] [--bg '#15101c'] [--out file.jpg]
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderJobs} from '../render.mjs';

const MOTION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.resolve(MOTION, '..', '.work', 'motion');

const argv = process.argv.slice(2);
const id = argv[0];
const opt = {};
for (let i = 1; i < argv.length; i += 2) opt[argv[i].replace(/^--/, '')] = argv[i + 1];
if (!id) {
	console.error('usage: node scripts/sheet.mjs <id> [--props JSON] [--frames a,b,c | --count N] [--size WxH] [--out file.jpg]');
	process.exit(2);
}
const catalog = JSON.parse(fs.readFileSync(path.join(MOTION, 'catalog.json'), 'utf8'));
const look = catalog.find((l) => l.id === id);
if (!look) throw new Error(`unknown look ${id}`);
let props = {};
if (opt.props) props = opt.props.trim().startsWith('{') ? JSON.parse(opt.props) : JSON.parse(fs.readFileSync(opt.props, 'utf8'));
if (opt.size) {
	const [w, h] = opt.size.split('x').map(Number);
	props = {...props, width: w, height: h};
}
const fps = props.fps ?? 30;
const dur = props.duration ?? look.default_duration;
const n = Math.round(dur * fps);
let frames;
if (opt.frames) frames = opt.frames.split(',').map((x) => Math.min(n - 1, parseInt(x, 10)));
else {
	const count = parseInt(opt.count ?? '10', 10);
	frames = Array.from({length: count}, (_, i) => Math.round((i * (n - 1)) / (count - 1)));
}
const tmp = path.join(WORK, 'sheets', `${id}_tmp`);
fs.rmSync(tmp, {recursive: true, force: true});
fs.mkdirSync(tmp, {recursive: true});
const jobs = frames.map((f) => ({id, props, frame: f, out: path.join(tmp, `${String(f).padStart(4, '0')}.png`)}));
const t0 = Date.now();
await renderJobs(jobs, {onResult: () => undefined});
const out = opt.out ? path.resolve(opt.out) : path.join(WORK, 'sheets', `${id}${opt.size ? `_${opt.size}` : ''}.jpg`);
const w = props.width ?? 1080;
const h = props.height ?? 1920;
const tileW = w >= h ? 480 : 270;
const tileH = Math.round((tileW * h) / w);
const cols = w >= h ? 4 : Math.min(frames.length, 6);
const args = ['montage'];
for (const j of jobs) args.push('-label', `f${path.basename(j.out, '.png').replace(/^0+(?=\d)/, '')} ${(parseInt(path.basename(j.out), 10) / fps).toFixed(2)}s`, j.out);
const labelFont = [path.join(MOTION, 'public', 'fonts', 'Inter', 'Inter-Medium.otf'), '/System/Library/Fonts/Supplemental/Arial.ttf'].find((f) => fs.existsSync(f));
args.push('-tile', `${cols}x`, '-geometry', `${tileW}x${tileH}+6+6`, '-background', opt.bg ?? '#15101c', '-fill', '#cccccc', '-pointsize', '14', ...(labelFont ? ['-font', labelFont] : []), out);
execFileSync('magick', args);
fs.rmSync(tmp, {recursive: true, force: true});
console.error(`${out}  (${frames.length} frames, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
