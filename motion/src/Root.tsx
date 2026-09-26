import React from 'react';
import {Composition, Folder, type CalculateMetadataFunction} from 'remotion';
import type {LookDef} from './lib/look';
import {LOOKS} from './looks';

const CATEGORY_ORDER = ['text', 'number', 'brand', 'fx', 'ui', 'diagram', 'data', 'background'];

const metadataFor = (look: LookDef): CalculateMetadataFunction<Record<string, unknown>> => {
	return ({props}) => {
		const parsed = look.schema.safeParse(props);
		if (!parsed.success) {
			const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
			throw new Error(`Invalid props for "${look.id}": ${issues}`);
		}
		const p = parsed.data as {duration: number; fps: number; width: number; height: number};
		return {
			durationInFrames: Math.max(1, Math.round(p.duration * p.fps)),
			fps: p.fps,
			width: Math.round(p.width),
			height: Math.round(p.height),
			props: parsed.data as Record<string, unknown>,
		};
	};
};

export const Root: React.FC = () => {
	const categories = CATEGORY_ORDER.filter((c) => LOOKS.some((l) => l.category === c));
	return (
		<>
			{categories.map((cat) => (
				<Folder key={cat} name={cat}>
					{LOOKS.filter((l) => l.category === cat).map((look) => (
						<Composition
							key={look.id}
							id={look.id}
							component={look.component}
							schema={look.schema}
							defaultProps={look.defaults}
							calculateMetadata={metadataFor(look)}
							durationInFrames={Math.round(look.duration * 30)}
							fps={30}
							width={1080}
							height={1920}
						/>
					))}
				</Folder>
			))}
		</>
	);
};
