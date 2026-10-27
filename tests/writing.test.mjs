import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StoryStream, STORIES } from '../src/modes/shared/stories.ts';
import { WritingLayout } from '../src/modes/shared/writing-layout.ts';
import { normalizeSettings } from '../src/engine/settings.ts';

describe('Story passages', () => {
  it('continues through the entire story collection before repeating', () => {
    assert.ok(STORIES.length >= 12);
    const book = STORIES.join('\n\n') + '\n\n';
    const stream = new StoryStream();
    const output = Array.from(
      { length: Array.from(book).length },
      () => stream.next().character,
    ).join('');
    assert.equal(output, book);
    assert.equal(stream.next().character, STORIES[0][0]);
    for (const story of STORIES) assert.ok(story.split('\n\n').length >= 3);
  });

  it('normalizes saved custom text and bounds its size without splitting emoji', () => {
    const settings = normalizeSettings({ storyText: '🙂'.repeat(2001) }, [
      'story',
    ]);
    assert.equal(Array.from(settings.storyText).length, 2000);
    assert.equal(settings.storyText.endsWith('🙂'), true);
    assert.equal(
      normalizeSettings({ storyText: '<hello>\r\nworld' }, ['story']).storyText,
      '<hello>\nworld',
    );
    assert.equal(
      normalizeSettings({ storyText: 123 }, ['story']).storyText,
      '',
    );
  });
});

describe('writing layout', () => {
  it('moves an entire story word to the next line when it will not fit', () => {
    const layout = new WritingLayout();
    layout.resize(400, 800, 32);
    layout.place(260);
    const position = layout.place(20, false, 120);
    assert.equal(position.x, layout.left);
    assert.equal(position.y, layout.top + layout.lineHeight);
  });

  it('keeps the cursor on screen during long typing sessions and after resize', () => {
    const layout = new WritingLayout();
    layout.resize(320, 480, 48);
    let scrolled = false;
    for (let i = 0; i < 1000; i++) {
      const position = layout.place(30);
      if (position.scroll > 0) scrolled = true;
      assert.ok(position.y + layout.lineHeight <= layout.bottom + 0.0001);
    }
    assert.equal(scrolled, true);
    layout.resize(1000, 800, 32);
    assert.equal(layout.x, layout.left);
    assert.equal(layout.y, layout.top);
  });
});
