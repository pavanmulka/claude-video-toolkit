// Registry of every look. Order = catalog order.
import type {LookDef} from '../lib/look';
import {bgGrid, bgLiquid, bgMesh, bgPaper, bgRays, bgSpace} from './backgrounds';
import {arcRings} from './arc-rings';
import {barChart} from './bar-chart';
import {calendarWeek} from './calendar-week';
import {cardWall} from './card-wall';
import {chatBubbles} from './chat-bubbles';
import {checklistGrid} from './checklist-grid';
import {commentReply} from './comment-reply';
import {doorReveal} from './door-reveal';
import {crowdFill} from './crowd-fill';
import {emojiBurst} from './emoji-burst';
import {endCard} from './end-card';
import {flowPath} from './flow-path';
import {hubBeams} from './hub-beams';
import {gather} from './gather';
import {nodeMap} from './node-map';
import {flowGraph} from './flow-graph';
import {teamChart} from './team-chart';
import {imageRain} from './image-rain';
import {stickerTiles} from './sticker-tiles';
import {lineChart} from './line-chart';
import {lineDraw} from './line-draw';
import {logoReveal} from './logo-reveal';
import {wordmarkSqueeze} from './wordmark-squeeze';
import {logoStamp} from './logo-stamp';
import {notificationStack} from './notification-stack';
import {photoCycle} from './photo-cycle';
import {floatCards} from './float-cards';
import {progressBar} from './progress-bar';
import {statCounter} from './stat-counter';
import {statOrbit} from './stat-orbit';
import {statSplit} from './stat-split';
import {textAssemble} from './text-assemble';
import {textBurst} from './text-burst';
import {textItalic} from './text-italic';
import {textMarker} from './text-marker';
import {textSplit} from './text-split';
import {textStack} from './text-stack';
import {textStrike} from './text-strike';
import {textSwap} from './text-swap';
import {textTrail} from './text-trail';
import {textTypewriter} from './text-typewriter';
import {timer} from './timer';
import {voiceNote} from './voice-note';
import {weekTicker} from './week-ticker';
import {fingerCount} from './finger-count';
import {brandStamp} from './brand-stamp';

export const LOOKS: LookDef[] = [
	// P1 text
	textBurst,
	textAssemble,
	textTrail,
	textItalic,
	textTypewriter,
	textStack,
	textMarker,
	textStrike,
	textSplit,
	textSwap,
	// P1 numbers
	statCounter,
	timer,
	weekTicker,
	fingerCount,
	brandStamp,
	// P1 brand
	logoStamp,
	logoReveal,
	wordmarkSqueeze,
	endCard,
	// P1 fx
	emojiBurst,
	progressBar,
	arcRings,
	crowdFill,
	imageRain,
	stickerTiles,
	doorReveal,
	// P2 UI storytelling
	chatBubbles,
	voiceNote,
	notificationStack,
	checklistGrid,
	commentReply,
	calendarWeek,
	cardWall,
	photoCycle,
	floatCards,
	// P3 diagrams + data
	flowPath,
	hubBeams,
	gather,
	nodeMap,
	flowGraph,
	teamChart,
	lineDraw,
	barChart,
	lineChart,
	statOrbit,
	statSplit,
	// P3 backgrounds
	bgMesh,
	bgSpace,
	bgRays,
	bgGrid,
	bgLiquid,
	bgPaper,
];
