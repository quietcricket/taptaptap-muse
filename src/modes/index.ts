import { floatMode } from './float';
import { tumbleMode } from './tumble';
import { trainMode } from './train';
import { storyMode } from './story';
import { typewriterMode } from './typewriter';
import { ripplesMode } from './ripples';
import { constellationMode } from './constellation';
import type { ModeDefinition } from '../engine/types';

export const modes: ModeDefinition[] = [
  floatMode,
  tumbleMode,
  trainMode,
  storyMode,
  typewriterMode,
  ripplesMode,
  constellationMode,
];
