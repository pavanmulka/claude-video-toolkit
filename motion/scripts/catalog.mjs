#!/usr/bin/env node
// Generates catalog.json from the zod schemas in src/looks (single source of truth).
//   node scripts/catalog.mjs        (also run automatically by render.mjs whenever src/ changes)
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const MOTION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(MOTION, 'catalog.json');

const COLOR_BRAND = '__remotion-color';

const describe = (schema, z) => {
	let s = schema;
	let doc;
	let dflt;
	let optional = false;
	for (let guard = 0; guard < 20; guard++) {
		const meta = z.globalRegistry.get(s);
		if (doc === undefined && meta?.doc) doc = meta.doc;
		const def = s._zod.def;
		if (def.type === 'default' || def.type === 'prefault') {
			if (dflt === undefined) dflt = def.defaultValue;
			s = def.innerType;
			continue;
		}
		if (def.type === 'optional' || def.type === 'nullable') {
			optional = true;
			s = def.innerType;
			continue;
		}
		break;
	}
	const meta = z.globalRegistry.get(s) ?? {};
	const def = s._zod.def;
	const out = {};
	switch (def.type) {
		case 'string':
			out.type = meta.description === COLOR_BRAND ? 'color' : 'string';
			break;
		case 'number': {
			const bag = s._zod.bag ?? {};
			out.type = bag.format && /int/.test(bag.format) ? 'integer' : 'number';
			const min = bag.minimum ?? bag.exclusiveMinimum;
			const max = bag.maximum ?? bag.exclusiveMaximum;
			if (Number.isFinite(min)) out.min = min;
			if (Number.isFinite(max)) out.max = max;
			break;
		}
		case 'boolean':
			out.type = 'boolean';
			break;
		case 'enum':
			out.type = 'enum';
			out.values = Object.values(def.entries);
			break;
		case 'literal':
			out.type = 'enum';
			out.values = [...def.values];
			break;
		case 'array':
			out.type = 'array';
			out.items = describe(def.element, z);
			break;
		case 'tuple':
			out.type = 'array';
			out.items = def.items.map((i) => describe(i, z));
			out.length = def.items.length;
			break;
		case 'object':
			out.type = 'object';
			out.props = Object.fromEntries(Object.entries(def.shape).map(([k, v]) => [k, describe(v, z)]));
			break;
		case 'union':
			out.type = 'union';
			out.options = def.options.map((o) => describe(o, z));
			break;
		default:
			out.type = def.type;
	}
	if (dflt !== undefined) out.default = dflt;
	if (optional) out.optional = true;
	if (doc) out.description = doc;
	return out;
};

export const buildCatalog = async ({quiet = false} = {}) => {
	const esbuild = await import('esbuild');
	const tmp = path.join(MOTION, '.bundle-cache', `catalog-entry-${process.pid}.mjs`);
	fs.mkdirSync(path.dirname(tmp), {recursive: true});
	await esbuild.build({
		entryPoints: [path.join(MOTION, 'src', 'catalog-entry.ts')],
		outfile: tmp,
		bundle: true,
		platform: 'node',
		format: 'esm',
		jsx: 'automatic',
		packages: 'external',
		logLevel: 'silent',
	});
	try {
		const mod = await import(pathToFileURL(tmp).href + `?t=${Date.now()}`);
		const {LOOKS, z} = mod;
		const catalog = LOOKS.map((look) => {
			const d = describe(look.schema, z);
			return {
				id: look.id,
				category: look.category,
				kind: look.kind,
				description: look.description,
				default_duration: look.duration,
				props: d.props,
			};
		});
		const json = JSON.stringify(catalog, null, 1) + '\n';
		if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== json) fs.writeFileSync(OUT, json);
		if (!quiet) process.stderr.write(`catalog.json: ${catalog.length} looks\n`);
		return catalog;
	} finally {
		fs.rmSync(tmp, {force: true});
	}
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	buildCatalog().catch((e) => {
		process.stderr.write(`catalog error: ${e.stack || e}\n`);
		process.exit(1);
	});
}
