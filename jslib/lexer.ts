// Base interface for config DSL lexers
// Conceptually a one-pass scanner through a string

// Parametrized by tag type, returns indices into input string
// User responsible for slicing wanted .substring(start, end)
export interface Token<T> {
  tag: T,
  start: number,
  end: number,
}

export type LexStream<T> = Iterable<Token<T>>
