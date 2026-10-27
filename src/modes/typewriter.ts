import type { ModeDefinition } from '../engine/types';
import { createWritingMode } from './shared/writing';

export const typewriterMode: ModeDefinition = {
  id: 'typewriter',
  name: 'Typewriter',
  symbol: '⌨',
  description: 'Important things are being written.',
  create: (ctx) => createWritingMode(ctx, false),
};
