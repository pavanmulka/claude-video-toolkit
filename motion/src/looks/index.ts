// Registry of every look. Order = catalog order.
import type {LookDef} from '../lib/look';
import {bgGrid, bgLiquid, bgMesh, bgPaper, bgRays, bgSpace} from './backgrounds';
import {barChart} from './bar-chart';
import {calendarWeek} from './calendar-week';
import {chatBubbles} from './chat-bubbles';
import {checklistGrid} from './checklist-grid';
import {commentReply} from './comment-reply';
import {emojiBurst} from './emoji-burst';
import {endCard} from './end-card';
import {flowPath} from './flow-path';
import {hubBeams} from './hub-beams';
import {lineChart} from './line-chart';
import {logoStamp} from './logo-stamp';
import {notificationStack} from './notification-stack';
import {progressBar} from './progress-bar';
import {statCounter} from './stat-counter';
import {statOrbit} from './stat-orbit';
import {textAssemble} from './text-assemble';
import {textBurst} from './text-burst';
import {textItalic} from './text-italic';
import {textMarker} from './text-marker';
import {textStack} from './text-stack';
import {textStrike} from './text-strike';
import {textTrail} from './text-trail';
import {textTypewriter} from './text-typewriter';
import {timer} from './timer';
import {voiceNote} from './voice-note';

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
	// P1 numbers
	statCounter,
	timer,
	// P1 brand
	logoStamp,
	endCard,
	// P1 fx
	emojiBurst,
	progressBar,
	// P2 UI storytelling
	chatBubbles,
	voiceNote,
	notificationStack,
	checklistGrid,
	commentReply,
	calendarWeek,
	// P3 diagrams + data
	flowPath,
	hubBeams,
	barChart,
	lineChart,
	statOrbit,
	// P3 backgrounds
	bgMesh,
	bgSpace,
	bgRays,
	bgGrid,
	bgLiquid,
	bgPaper,
];
