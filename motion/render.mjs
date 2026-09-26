#!/usr/bin/env node
// VTK motion renderer: renders Remotion "looks" (see catalog.json / README.md) to video layers.
//
//   node render.mjs --jobs jobs.json            [{"id","props","out"}, ...] -> one JSON line per job on stdout
//   node render.mjs --still --id <id> --props <props.json|JSON> --frame <n|mid|last> --out <file.png>
//   node render.mjs --list                      catalog JSON (no bundling)
//   node render.mjs --sync-fonts                copy ../brand/fonts into public/fonts + manifest
//   node render.mjs --catalog                   regenerate catalog.json from the zod schemas
//
// Options: --concurrency N (default: half the cores), --gl <angle|swangle|...>, --verbose
// stdout carries only JSON lines; logs and progress go to stderr. Exit code 1 on failure.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const MOTION = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(MOTION, '..');
const PUBLIC = path.join(MOTION, 'public');
const FONTS_OUT = path.join(PUBLIC, 'fonts');
const ASSETS_OUT = path.join(PUBLIC, '_assets');
const CACHE = path.join(MOTION, '.bundle-cache');
const CATALOG = path.join(MOTION, 'catalog.json');
const FONT_DIRS = [path.join(REPO, 'brand', 'fonts'), ...(process.env.VTK_FONT_DIRS ? process.env.VTK_FONT_DIRS.split(path.delimiter) : [])];
const ORIG_CWD = process.cwd();

// Keep stdout clean for machine-readable JSON lines.
const log = (...a) => process.stderr.write(a.map(String).join(' ') + '\n');
console.log = (...a) => console.error(...a);
console.info = (...a) => console.error(...a);
const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

// ---------------------------------------------------------------- args
const parseArgs = (argv) => {
	const flags = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith('--')) throw new Error(`Unexpected argument "${a}"`);
		const eq = a.indexOf('=');
		if (eq > 0) {
			flags[a.slice(2, eq)] = a.slice(eq + 1);
			continue;
		}
		const k = a.slice(2);
		const next = argv[i + 1];
		if (next === undefined || next.startsWith('--')) flags[k] = true;
		else {
			flags[k] = next;
			i++;
		}
	}
	return flags;
};
const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
// Flags are only read from argv when this file is the entry point (scripts import its functions).
let flags = {};
let VERBOSE = false;
const resolveUserPath = (p) => path.resolve(ORIG_CWD, String(p));

// ---------------------------------------------------------------- fonts
// Minimal sfnt reader: family (name id 16 || 1), weight (OS/2), italic, variable axes (fvar).
const readFontInfo = (buf) => {
	const numTables = buf.readUInt16BE(4);
	const tables = {};
	for (let i = 0; i < numTables; i++) {
		const o = 12 + i * 16;
		tables[buf.toString('latin1', o, o + 4)] = {offset: buf.readUInt32BE(o + 8), length: buf.readUInt32BE(o + 12)};
	}
	const names = {};
	if (tables.name) {
		const base = tables.name.offset;
		const count = buf.readUInt16BE(base + 2);
		const strings = base + buf.readUInt16BE(base + 4);
		for (let i = 0; i < count; i++) {
			const r = base + 6 + i * 12;
			const pid = buf.readUInt16BE(r);
			const eid = buf.readUInt16BE(r + 2);
			const lid = buf.readUInt16BE(r + 4);
			const nid = buf.readUInt16BE(r + 6);
			const len = buf.readUInt16BE(r + 8);
			const off = buf.readUInt16BE(r + 10);
			const raw = buf.subarray(strings + off, strings + off + len);
			let s = null;
			if (pid === 3 || pid === 0) s = Buffer.from(raw).swap16().toString('utf16le');
			else if (pid === 1 && eid === 0) s = raw.toString('latin1');
			if (s === null) continue;
			const english = pid !== 3 || lid === 0x409;
			if (english || !(nid in names)) names[nid] = s;
		}
	}
	let weight = 400;
	let italic = false;
	if (tables['OS/2']) {
		weight = buf.readUInt16BE(tables['OS/2'].offset + 4);
		italic = Boolean(buf.readUInt16BE(tables['OS/2'].offset + 62) & 1);
	}
	if (tables.head && buf.readUInt16BE(tables.head.offset + 44) & 2) italic = true;
	const axes = {};
	if (tables.fvar) {
		const b = tables.fvar.offset;
		const axesOff = buf.readUInt16BE(b + 4);
		const count = buf.readUInt16BE(b + 8);
		const size = buf.readUInt16BE(b + 10);
		for (let i = 0; i < count; i++) {
			const a = b + axesOff + i * size;
			axes[buf.toString('latin1', a, a + 4)] = {min: buf.readInt32BE(a + 4) / 65536, def: buf.readInt32BE(a + 8) / 65536, max: buf.readInt32BE(a + 12) / 65536};
		}
	}
	if (/italic/i.test(names[17] || names[2] || '')) italic = true;
	return {family: (names[16] || names[1] || '').trim(), weight, italic, axes};
};

const walk = (dir, out = []) => {
	if (!fs.existsSync(dir)) return out;
	for (const ent of fs.readdirSync(dir, {withFileTypes: true})) {
		if (ent.name.startsWith('.')) continue;
		const p = path.join(dir, ent.name);
		if (ent.isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
};

const sanitize = (name) => name.replace(/\[[^\]]*\]/g, '-VF').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-');

/** Copies brand fonts into public/fonts (variable fonts preferred) and writes public/fonts/manifest.json. */
export const syncFonts = () => {
	const found = [];
	for (const dir of FONT_DIRS) {
		for (const file of walk(dir)) {
			if (!/\.(ttf|otf|woff2?)$/i.test(file)) continue;
			try {
				const info = readFontInfo(fs.readFileSync(file));
				if (!info.family) continue;
				found.push({file, dir, ...info});
			} catch (e) {
				if (VERBOSE) log(`font skipped (${file}): ${e.message}`);
			}
		}
	}
	const families = {};
	const byFamily = new Map();
	for (const f of found) {
		if (!byFamily.has(f.family)) byFamily.set(f.family, []);
		byFamily.get(f.family).push(f);
	}
	const wanted = [];
	for (const [family, list] of byFamily) {
		const faces = [];
		for (const style of ['normal', 'italic']) {
			const ofStyle = list.filter((f) => (style === 'italic') === f.italic);
			const variable = ofStyle.filter((f) => f.axes.wght);
			const chosen = variable.length ? [variable[0]] : ofStyle;
			for (const f of chosen) {
				const rel = path.join(sanitize(path.basename(path.dirname(f.file))), sanitize(path.basename(f.file)));
				const wmin = f.axes.wght ? Math.round(f.axes.wght.min) : f.weight;
				const wmax = f.axes.wght ? Math.round(f.axes.wght.max) : f.weight;
				faces.push({
					file: rel.split(path.sep).join('/'),
					weight: wmin === wmax ? String(wmin) : `${wmin} ${wmax}`,
					style,
					...(f.axes.wdth ? {stretch: `${f.axes.wdth.min}% ${f.axes.wdth.max}%`} : {}),
					wmin,
					wmax,
				});
				wanted.push({src: f.file, rel});
			}
		}
		families[family] = faces;
	}
	let copied = 0;
	for (const {src, rel} of wanted) {
		const dest = path.join(FONTS_OUT, rel);
		const st = fs.statSync(src);
		let same = false;
		try {
			const dt = fs.statSync(dest);
			same = dt.size === st.size && dt.mtimeMs >= st.mtimeMs;
		} catch {}
		if (same) continue;
		fs.mkdirSync(path.dirname(dest), {recursive: true});
		fs.copyFileSync(src, dest);
		copied++;
	}
	const manifest = JSON.stringify({generated_by: 'render.mjs --sync-fonts', sources: FONT_DIRS, families}, null, 1);
	const mpath = path.join(FONTS_OUT, 'manifest.json');
	fs.mkdirSync(FONTS_OUT, {recursive: true});
	if (!fs.existsSync(mpath) || fs.readFileSync(mpath, 'utf8') !== manifest) fs.writeFileSync(mpath, manifest);
	if (copied) log(`fonts: copied ${copied} file(s) into public/fonts (${Object.keys(families).length} families)`);
	return families;
};

// ---------------------------------------------------------------- assets
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

const copyAsset = (file) => {
	const buf = fs.readFileSync(file);
	const ext = (path.extname(file) || '.bin').toLowerCase();
	const rel = `_assets/${sha1(buf)}${ext}`;
	const dest = path.join(PUBLIC, rel);
	if (!fs.existsSync(dest)) {
		fs.mkdirSync(path.dirname(dest), {recursive: true});
		const tmp = `${dest}.${process.pid}.tmp`;
		fs.writeFileSync(tmp, buf);
		fs.renameSync(tmp, dest);
	}
	return rel;
};

/** Any string prop that is an absolute path to an existing file -> copied to public/_assets, rewritten. */
export const rewriteAssets = (value) => {
	if (typeof value === 'string') {
		if (value.length < 4096 && path.isAbsolute(value)) {
			try {
				if (fs.statSync(value).isFile()) return copyAsset(value);
			} catch {}
		}
		return value;
	}
	if (Array.isArray(value)) return value.map(rewriteAssets);
	if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewriteAssets(v)]));
	return value;
};

// ---------------------------------------------------------------- bundle cache
const sourceHash = () => {
	const h = crypto.createHash('sha1');
	const files = [...walk(path.join(MOTION, 'src')), ...['package.json', 'package-lock.json', 'tsconfig.json', 'remotion.config.ts'].map((f) => path.join(MOTION, f))]
		.filter((f) => fs.existsSync(f))
		.sort();
	for (const f of files) {
		h.update(path.relative(MOTION, f));
		h.update('\0');
		h.update(fs.readFileSync(f));
	}
	return h.digest('hex').slice(0, 16);
};

const pruneBundles = (keep, current) => {
	const dirs = fs
		.readdirSync(CACHE, {withFileTypes: true})
		.filter((d) => d.isDirectory() && /^[0-9a-f]{16}$/.test(d.name) && d.name !== current)
		.map((d) => ({name: d.name, mtime: fs.statSync(path.join(CACHE, d.name)).mtimeMs}))
		.sort((a, b) => b.mtime - a.mtime);
	for (const d of dirs.slice(Math.max(0, keep - 1))) fs.rmSync(path.join(CACHE, d.name), {recursive: true, force: true});
};

/** Bundles src/ once per source hash into .bundle-cache/<hash> (public/ is symlinked, so fonts and assets added later are visible). */
export const getBundle = async () => {
	const hash = sourceHash();
	const dir = path.join(CACHE, hash);
	if (fs.existsSync(path.join(dir, 'index.html'))) {
		const now = new Date();
		fs.utimesSync(dir, now, now);
		if (!fs.existsSync(CATALOG)) {
			const {buildCatalog} = await import('./scripts/catalog.mjs');
			await buildCatalog({quiet: true});
		}
		return dir;
	}
	fs.mkdirSync(CACHE, {recursive: true});
	log(`bundling motion/src (${hash}) ...`);
	const t0 = Date.now();
	const {bundle} = await import('@remotion/bundler');
	const tmp = path.join(CACHE, `.tmp-${hash}-${process.pid}`);
	fs.rmSync(tmp, {recursive: true, force: true});
	fs.mkdirSync(PUBLIC, {recursive: true});
	await bundle({
		entryPoint: path.join(MOTION, 'src', 'index.ts'),
		outDir: tmp,
		publicDir: PUBLIC,
		symlinkPublicDir: true,
		enableCaching: true,
		onProgress: () => undefined,
	});
	try {
		fs.renameSync(tmp, dir);
	} catch (e) {
		if (fs.existsSync(path.join(dir, 'index.html'))) fs.rmSync(tmp, {recursive: true, force: true});
		else throw e;
	}
	log(`bundled in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
	try {
		const {buildCatalog} = await import('./scripts/catalog.mjs');
		await buildCatalog({quiet: true});
	} catch (e) {
		log(`warning: catalog.json not regenerated: ${e.message}`);
	}
	pruneBundles(3, hash);
	return dir;
};

// ---------------------------------------------------------------- rendering
const readCatalog = () => {
	if (!fs.existsSync(CATALOG)) throw new Error('catalog.json is missing: run `node render.mjs --catalog` (or `npm run catalog`)');
	return JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
};

const concurrency = () => {
	const v = flags.concurrency ?? process.env.VTK_MOTION_CONCURRENCY;
	if (v) return Math.max(1, parseInt(v, 10));
	return Math.max(1, Math.floor(os.cpus().length / 2));
};

const chromiumOptions = () => ({
	gl: flags.gl ?? process.env.VTK_MOTION_GL ?? (process.platform === 'darwin' ? 'angle' : null),
	headless: true,
});

/** Encoder for an output path. Alpha -> ProRes 4444; opaque -> H.264 CRF 14 (or ProRes 422 HQ on request). */
const encoderFor = (out, alpha, codecOverride, dims) => {
	const ext = path.extname(out).toLowerCase();
	if (alpha) {
		if (ext === '.webm') return {codec: 'vp9', imageFormat: 'png', pixelFormat: 'yuva420p', crf: 18, label: 'VP9 + alpha'};
		if (ext !== '.mov' && ext !== '.mkv') throw new Error(`transparent output needs a .mov path (ProRes 4444 + alpha), got "${out}"`);
		return {codec: 'prores', proResProfile: '4444', pixelFormat: 'yuva444p10le', imageFormat: 'png', label: 'ProRes 4444 + alpha'};
	}
	const odd = dims.width % 2 || dims.height % 2;
	if (codecOverride === 'prores' || odd || ext === '.mxf') {
		if (ext === '.mp4') throw new Error(`ProRes needs a .mov path, got "${out}"`);
		return {codec: 'prores', proResProfile: 'hq', pixelFormat: 'yuv422p10le', imageFormat: 'png', label: 'ProRes 422 HQ'};
	}
	if (!['.mov', '.mp4', '.mkv'].includes(ext)) throw new Error(`unsupported output extension "${ext}" (use .mov or .mp4)`);
	// opaque frames are captured as JPEG q95 (much faster than PNG for grainy full-frame backgrounds)
	return {codec: 'h264', crf: 14, pixelFormat: 'yuv420p', imageFormat: 'jpeg', jpegQuality: 95, x264Preset: 'medium', label: 'H.264 CRF 14'};
};

const lookFor = (catalog, id) => {
	const look = catalog.find((l) => l.id === id);
	if (!look) throw new Error(`unknown look "${id}". Known: ${catalog.map((l) => l.id).join(', ')}`);
	return look;
};

const isTransparent = (look, props) => {
	if (look.kind === 'background') return false;
	if (typeof props.transparent === 'boolean') return props.transparent;
	return Boolean(look.props?.transparent?.default ?? look.kind === 'overlay');
};

const fmtErr = (e) => {
	const msg = ((e && e.message) || String(e)).replace(/^(Error: )+/, '');
	return VERBOSE && e && e.stack ? e.stack : msg.split('\n').slice(0, 12).join('\n');
};

const openRenderer = async () => {
	const renderer = await import('@remotion/renderer');
	await renderer.ensureBrowser({
		logLevel: 'error',
		onBrowserDownload: () => {
			log('downloading Chrome Headless Shell for Remotion (first run only) ...');
			return {
				version: null,
				onProgress: ({percent}) => {
					if (process.stderr.isTTY) process.stderr.write(`\r  ${Math.round(percent * 100)}%   `);
				},
			};
		},
	});
	const browser = await renderer.openBrowser('chrome', {chromiumOptions: chromiumOptions(), logLevel: VERBOSE ? 'info' : 'error'});
	return {renderer, browser};
};

const progressPrinter = (label) => {
	let last = -1;
	return ({progress}) => {
		if (!process.stderr.isTTY) return;
		const pct = Math.floor(progress * 100);
		if (pct !== last) {
			last = pct;
			process.stderr.write(`\r  ${label} ${pct}%   `);
		}
	};
};

const renderOne = async ({renderer, browser, serveUrl, catalog, job}) => {
	const t0 = performance.now();
	if (!job || typeof job !== 'object') throw new Error('each job must be an object {id, props, out}');
	if (!job.id) throw new Error('job without "id"');
	if (!job.out) throw new Error(`job "${job.id}" has no "out" path`);
	const look = lookFor(catalog, job.id);
	const props = rewriteAssets(job.props ?? {});
	const out = resolveUserPath(job.out);
	fs.mkdirSync(path.dirname(out), {recursive: true});
	const composition = await renderer.selectComposition({
		serveUrl,
		id: job.id,
		inputProps: props,
		puppeteerInstance: browser,
		chromiumOptions: chromiumOptions(),
		logLevel: 'error',
	});
	const alpha = isTransparent(look, composition.props ?? props);
	const common = {composition, serveUrl, inputProps: props, puppeteerInstance: browser, chromiumOptions: chromiumOptions(), logLevel: VERBOSE ? 'info' : 'error'};
	if (/\.png$/i.test(out)) {
		const n = composition.durationInFrames;
		const f = job.frame === undefined || job.frame === 'mid' ? Math.floor(n / 2) : job.frame === 'last' ? n - 1 : Math.min(n - 1, Math.max(0, parseInt(job.frame, 10)));
		await renderer.renderStill({...common, output: out, frame: f, imageFormat: 'png', overwrite: true});
		return {id: job.id, out, frame: f, width: composition.width, height: composition.height, alpha, render_seconds: +((performance.now() - t0) / 1000).toFixed(2)};
	}
	const enc = encoderFor(out, alpha, job.codec, composition);
	await renderer.renderMedia({
		...common,
		codec: enc.codec,
		outputLocation: out,
		imageFormat: enc.imageFormat,
		pixelFormat: enc.pixelFormat,
		...(enc.proResProfile ? {proResProfile: enc.proResProfile} : {}),
		...(enc.crf !== undefined ? {crf: enc.crf} : {}),
		...(enc.x264Preset ? {x264Preset: enc.x264Preset} : {}),
		...(enc.jpegQuality ? {jpegQuality: enc.jpegQuality} : {}),
		colorSpace: 'bt709',
		muted: true,
		overwrite: true,
		concurrency: concurrency(),
		onProgress: progressPrinter(job.id),
	});
	if (process.stderr.isTTY) process.stderr.write('\r');
	return {
		id: job.id,
		out,
		frames: composition.durationInFrames,
		seconds: +(composition.durationInFrames / composition.fps).toFixed(4),
		fps: composition.fps,
		width: composition.width,
		height: composition.height,
		alpha,
		codec: enc.label,
		render_seconds: +((performance.now() - t0) / 1000).toFixed(2),
	};
};

const loadJSONArg = (v, what) => {
	if (v === undefined || v === true) return {};
	const s = String(v).trim();
	if (s.startsWith('{') || s.startsWith('[')) return JSON.parse(s);
	const file = resolveUserPath(s);
	if (!fs.existsSync(file)) throw new Error(`${what} file not found: ${file}`);
	return JSON.parse(fs.readFileSync(file, 'utf8'));
};

export const renderJobs = async (jobs, {onResult = emit} = {}) => {
	if (!Array.isArray(jobs)) throw new Error('jobs must be a JSON array of {id, props, out}');
	syncFonts();
	const serveUrl = await getBundle();
	const fresh = readCatalog();
	for (const j of jobs) lookFor(fresh, j?.id);
	const {renderer, browser} = await openRenderer();
	const results = [];
	try {
		for (const job of jobs) {
			try {
				const res = await renderOne({renderer, browser, serveUrl, catalog: fresh, job});
				results.push(res);
				onResult(res);
			} catch (e) {
				const err = new Error(`job "${job?.id}" -> ${job?.out}: ${fmtErr(e)}`);
				err.job = job;
				throw err;
			}
		}
	} finally {
		await browser.close({silent: true}).catch(() => undefined);
	}
	return results;
};

/** Options for scripts that import this module (concurrency, gl, verbose). */
export const setOptions = (o) => {
	flags = {...flags, ...o};
	VERBOSE = Boolean(flags.verbose);
};

const main = async () => {
	if (flags.help || Object.keys(flags).length === 0) {
		log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 13).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
		process.exit(flags.help ? 0 : 2);
	}
	process.chdir(MOTION); // Remotion caches (browser download, webpack cache) live under motion/node_modules
	if (flags.list) {
		process.stdout.write(fs.readFileSync(CATALOG, 'utf8'));
		return;
	}
	if (flags['sync-fonts']) {
		const fam = syncFonts();
		log(`fonts: ${Object.keys(fam).length} families -> public/fonts/manifest.json`);
		return;
	}
	if (flags.catalog) {
		const {buildCatalog} = await import('./scripts/catalog.mjs');
		await buildCatalog({quiet: false});
		return;
	}
	if (flags.bundle) {
		syncFonts();
		log(await getBundle());
		return;
	}
	if (flags.still) {
		if (!flags.id || !flags.out) throw new Error('--still needs --id <look> and --out <file.png>');
		const props = loadJSONArg(flags.props, '--props');
		const frame = flags.frame === undefined ? 'mid' : flags.frame;
		await renderJobs([{id: flags.id, props, out: flags.out, frame}]);
		return;
	}
	if (flags.jobs) {
		const jobs = loadJSONArg(flags.jobs, '--jobs');
		await renderJobs(jobs);
		return;
	}
	throw new Error('nothing to do: use --jobs, --still, --list, --sync-fonts or --catalog (see --help)');
};

if (isMain) {
	try {
		flags = parseArgs(process.argv.slice(2));
		VERBOSE = Boolean(flags.verbose);
	} catch (e) {
		log(`render.mjs error: ${e.message}`);
		process.exit(2);
	}
	main().then(
		() => process.exit(0),
		(e) => {
			log(`render.mjs error: ${fmtErr(e)}`);
			process.exit(1);
		},
	);
}
