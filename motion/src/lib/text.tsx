import type React from 'react';
import {font2Css} from './fonts';
import type {Word} from './rich';
import type {Font2Props} from './schema';

/** Renders a word's segments: **accent** runs in `accent`, *em* runs in font2 (italic). */
export const Segs: React.FC<{
	word: Word;
	fg: string;
	accent: string;
	font2: Font2Props;
	accentStyle?: React.CSSProperties;
	emScale?: number;
}> = ({word, fg, accent, font2, accentStyle, emScale = 1.12}) => (
	<>
		{word.segs.map((s, i) => (
			<span
				key={i}
				style={{
					color: s.accent || s.em ? accent : fg,
					...(s.em ? {...font2Css(font2), fontSize: `${emScale}em`, letterSpacing: '-0.01em'} : {}),
					...(s.accent ? accentStyle : {}),
				}}
			>
				{s.text}
			</span>
		))}
	</>
);

/** Absolutely positioned block centred on (x, y) fractions of the frame. */
export const Anchor: React.FC<{
	x: number;
	y: number;
	W: number;
	H: number;
	width?: number | string;
	transform?: string;
	style?: React.CSSProperties;
	children: React.ReactNode;
}> = ({x, y, W, H, width, transform = '', style, children}) => (
	<div
		style={{
			position: 'absolute',
			left: x * W,
			top: y * H,
			// absolutely positioned boxes otherwise shrink to the space right of `left`
			width: width ?? 'max-content',
			transform: `translate(-50%, -50%) ${transform}`,
			...style,
		}}
	>
		{children}
	</div>
);
