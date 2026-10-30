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

export function forwardedPlayKey(
  event: Pick<
    KeyboardEvent,
    | 'key'
    | 'defaultPrevented'
    | 'ctrlKey'
    | 'metaKey'
    | 'altKey'
    | 'isComposing'
  >,
  editing: boolean,
): string | null {
  if (
    editing ||
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.isComposing
  )
    return null;
  return characterForKey(event.key) || event.key === 'Escape'
    ? event.key
    : null;
}
