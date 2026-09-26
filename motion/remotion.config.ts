// Only used by `npm run studio` / the remotion CLI. render.mjs sets its own options.
import {Config} from '@remotion/cli/config';

Config.setEntryPoint('src/index.ts');
Config.setVideoImageFormat('png');
Config.setOverwriteOutput(true);
