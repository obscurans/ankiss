// Copyright Jeffrey Tsang <jeffrey.tsang@ieee.org>
// GNU AGPL, 3.0 or later <https://www.gnu.org/licenses/agpl-3.0.html>

// Parametrized by tag type, returns indices into input string
// User responsible for slicing wanted .substring(start, end)
export interface Token<T> {
  tag: T,
  start: number,
  end: number,
}

export type LexStream<T> = Iterable<Token<T>>
