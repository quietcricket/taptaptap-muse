import type { ModeDefinition } from '../engine/types';
import { createWritingMode } from './shared/writing';

export const storyMode: ModeDefinition = {
  id: 'story',
  name: 'Story',
  symbol: '¶',
  description: 'Every key has a story to tell.',
  letterLifespan: null,
  create: (ctx) => createWritingMode(ctx, true),
};
