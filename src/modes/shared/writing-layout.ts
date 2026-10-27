/** A small layout helper with no renderer dependency, shared by both writing modes. */
export class WritingLayout {
  x = 0;
  y = 0;
  left = 0;
  right = 0;
  top = 0;
  bottom = 0;
  lineHeight = 0;

  resize(width: number, height: number, fontSize: number): void {
    const pageWidth = Math.min(1000, Math.max(100, width - 48));
    this.left = Math.max(18, (width - pageWidth) / 2);
    this.right = Math.max(this.left + fontSize, width - this.left);
    this.top = Math.min(155, Math.max(100, height * 0.22));
    this.lineHeight = fontSize * 1.6;
    this.bottom = Math.max(this.top + this.lineHeight, height - 150);
    this.reset();
  }

  reset(): void {
    this.x = this.left;
    this.y = this.top;
  }

  place(
    width: number,
    newline = false,
    wordWidth = 0,
  ): { x: number; y: number; scroll: number } {
    const lookahead = Math.min(
      this.right - this.left,
      Math.max(width, wordWidth),
    );
    if (newline || (this.x > this.left && this.x + lookahead > this.right)) {
      this.x = this.left;
      this.y += this.lineHeight;
    }
    const scroll = Math.max(0, this.y + this.lineHeight - this.bottom);
    this.y -= scroll;
    const position = { x: this.x, y: this.y, scroll };
    if (!newline) this.x += width;
    return position;
  }
}
