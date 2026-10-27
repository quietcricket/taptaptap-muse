import { CanvasTextMetrics, Graphics, type Text } from 'pixi.js';
import type { ModeContext, PlayMode } from '../../engine/types';
import { StoryStream } from './stories';
import { WritingLayout } from './writing-layout';

export function createWritingMode(ctx: ModeContext, story: boolean): PlayMode {
  const entries: { text: Text; character: string; word: string }[] = [];
  const stream = new StoryStream(ctx.storyText);
  const layout = new WritingLayout();
  const cursor = new Graphics();
  ctx.stage.addChild(cursor);
  const fontSize = () => Math.min(58, Math.max(24, ctx.letterSize * 0.48));
  let time = 0;
  let sinceInput = 0;

  function drawCursor(): void {
    cursor
      .clear()
      .rect(layout.x + 2, layout.y + 3, 2, fontSize())
      .fill('#e56b43');
    cursor.alpha = sinceInput < 0.6 || Math.floor(time * 2) % 2 === 0 ? 0.8 : 0;
  }

  function place(entry: (typeof entries)[number], playSound = false): void {
    const newline = entry.character === '\n';
    const width = newline ? 0 : Math.max(fontSize() * 0.24, entry.text.width);
    const wordWidth = entry.word
      ? CanvasTextMetrics.measureText(entry.word, entry.text.style).width
      : 0;
    const position = layout.place(width, newline, wordWidth);
    if (position.scroll)
      for (const other of entries) other.text.y -= position.scroll;
    entry.text.position.set(position.x, position.y);
    if (
      playSound &&
      (newline || (position.x === layout.left && entries.length > 1))
    )
      ctx.sound('clink', 0.25);
  }

  function resize(): void {
    layout.resize(ctx.bounds.width, ctx.bounds.height, fontSize());
    for (const entry of entries) place(entry);
    drawCursor();
  }
  resize();

  return {
    onKey(input) {
      sinceInput = 0;
      if (!story && input === '⌫') {
        const last = entries.pop();
        last?.text.destroy();
        resize();
        return;
      }
      if (!entries.length) {
        layout.reset();
      }
      const token = story
        ? stream.next()
        : {
            character: input === '·' ? ' ' : input === '↵' ? '\n' : input,
            word: '',
          };
      const text = ctx.createLetter(
        token.character === '\n' ? ' ' : token.character,
        fontSize(),
        (expired) => {
          const index = entries.findIndex((entry) => entry.text === expired);
          if (index !== -1) entries.splice(index, 1);
          if (!entries.length) layout.reset();
        },
      );
      text.anchor.set(0, 0);
      text.style.fill = '#30352c';
      const entry = { text, ...token };
      entries.push(entry);
      place(entry, true);
      drawCursor();
    },
    update(delta) {
      time += delta;
      sinceInput += delta;
      drawCursor();
    },
    resize,
    dispose() {
      entries.length = 0;
    },
  };
}
