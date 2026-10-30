import { mountPlayground } from './game';
import { modes } from './modes';

const dispose = mountPlayground(modes);
if (import.meta.hot) import.meta.hot.dispose(dispose);
