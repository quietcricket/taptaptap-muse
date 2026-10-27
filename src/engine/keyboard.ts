const symbols: Record<string, string> = {
  ' ': '·',
  Enter: '↵',
  Backspace: '⌫',
  Delete: '×',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};
export function characterForKey(key: string): string | null {
  if (symbols[key]) return symbols[key];
  return [...key].length === 1 ? key : null;
}
