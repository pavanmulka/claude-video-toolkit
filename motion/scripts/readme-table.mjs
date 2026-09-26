#!/usr/bin/env node
// Regenerates the looks table in README.md (between <!-- looks:start --> and <!-- looks:end -->) from catalog.json.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const MOTION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMON = new Set(['width', 'height', 'fps', 'duration', 'transparent', 'theme', 'font', 'font2', 'delay', 'outro']);
const catalog = JSON.parse(fs.readFileSync(path.join(MOTION, 'catalog.json'), 'utf8'));
const timesFile = path.join(MOTION, '..', '.work', 'motion', 'render_times.json');
const times = fs.existsSync(timesFile) ? JSON.parse(fs.readFileSync(timesFile, 'utf8')) : {};

const fmtDefault = (v) => {
	if (v === undefined) return '';
	if (typeof v === 'string') {
		const s = v.replace(/\n/g, '\\n');
		return s === '' ? '""' : `"${s.length > 28 ? `${s.slice(0, 26)}…` : s}"`;
	}
	if (Array.isArray(v)) return `[${v.length}]`;
	if (typeof v === 'object') return '{…}';
	return String(v);
};

const rows = catalog.map((l) => {
	const props = Object.entries(l.props)
		.filter(([k]) => !COMMON.has(k))
		.map(([k, v]) => `\`${k}\`${v.default !== undefined ? `=${fmtDefault(v.default).replace(/\|/g, '\\|')}` : ''}`)
		.join(', ');
	const tm = times[l.id] ? `${times[l.id].fps_rendered}` : '';
	return `| \`${l.id}\` | ${l.kind} | ${l.default_duration}s | ${tm} | ${l.description.replace(/\|/g, '\\|')} | ${props} |`;
});
const table = ['| id | kind | default dur | render fps* | what it looks like | look props (defaults) |', '|---|---|---|---|---|---|', ...rows].join('\n');

const readme = path.join(MOTION, 'README.md');
const src = fs.readFileSync(readme, 'utf8');
const out = src.replace(/<!-- looks:start -->[\s\S]*<!-- looks:end -->/, `<!-- looks:start -->\n${table}\n<!-- looks:end -->`);
fs.writeFileSync(readme, out);
console.error(`README.md: ${rows.length} looks`);
