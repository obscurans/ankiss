// Copyright Jeffrey Tsang <jeffrey.tsang@ieee.org>
// GNU AGPL, 3.0 or later <https://www.gnu.org/licenses/agpl-3.0.html>

// Black magic for natural numbers strictly below n
export type NatLT<N extends number, T = never, R extends unknown[] = []> =
 R['length'] extends N ? T : NatLT<N, T | R['length'], [...R, R['length']]>;

// Black magic for a fixed-length homogeneous array
// N can be a union of numbers: Tuple<number, 0 | 2 | 4> = [] | [number, number] | [number, number, number, number]
// Anders Hejlsberg <https://github.com/microsoft/TypeScript/pull/40002>
export type Tuple<T, N extends number> = N extends N ? number extends N ? T[] : _TupleOf<T, N, []> : never;
type _TupleOf<T, N extends number, R extends unknown[]> = R['length'] extends N ? R : _TupleOf<T, N, [T, ...R]>;

/* v8 ignore start */
export class AssertionError extends Error {
  constructor() {
    super('assertion failed');
    this.name = 'AssertionError';
  }
}

export function devAssert(p: unknown): asserts p {
  if (!import.meta.env.PROD && !p) {
    throw new AssertionError();
  }
}

export function exhaustive(p: never) {
  if (!import.meta.env.PROD) {
    throw new AssertionError();
  }
}
/* v8 ignore stop */
