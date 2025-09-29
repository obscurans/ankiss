// Copyright Jeffrey Tsang <jeffrey.tsang@ieee.org>
// GNU AGPL, 3.0 or later <https://www.gnu.org/licenses/agpl-3.0.html>

import { expect, test } from 'vitest';
import fc from 'fast-check';
import { parse, TagError, type TagMapping } from '#tags/parseLine';
import { arbTreeMix, arbTreeWithError, FakeNesting, FakeTree, type ParseInput } from '#tags/parseLine.arbitrary';
import type { Token } from '#types';
import type { Tag } from '#tags/lexWsOnly';

type HarnessPredicate = (s:string, l:Token<Tag>[], r:TagMapping[]) => any;

function checkHarnessImpl(input: ParseInput, predicate: HarnessPredicate, skipParse: boolean) {
  const [s, ll] = input;
  const l = Array.from(ll);
  if (skipParse) {
    return predicate(s, l, []);
  } else {
    try {
      const r = Array.from(parse(s, l));
      return predicate(s, l, r);
    } catch (e) {
      throw new TagError(s + '\n' + JSON.stringify(l), { cause: e });
    }
  }
}

function checkHarness(predicate: HarnessPredicate, skipParse: boolean = false) {
  fc.assert(
    fc.property(
      arbTreeMix,
      (tree) => checkHarnessImpl(tree.toParseInput(), predicate, skipParse)
    ),
    { examples: [[ new FakeTree(null, [], false) ]] },
  );
}

function checkHarnessWithError(predicate: HarnessPredicate, skipParse: boolean = false) {
  fc.assert(
    fc.property(
      arbTreeWithError,
      ([tree, inject]) => {
        const input = tree.toParseInputWithError(inject);
        if (input !== null) {
          return checkHarnessImpl(input, predicate, skipParse);
        }
      }
    ),
  );
}

function lexerInvariant(s: string, l: Token<Tag>[], r: any) {
  if (l.length > 0) {
    expect(l[0].start).toBe(0);
    expect(l[l.length - 1].end).toBe(s.length);
  }

  l.forEach(({ start, end }) => {
    expect(end).toBeGreaterThan(start);
  });

  for (let i = 0; i < l.length - 1; i++) {
    expect(l[i].end).toBe(l[i + 1].start);
    if ((l[i].tag === 'ws') && (l[i + 1].tag === 'ws')) {
      throw l;
    } else if ((l[i].tag === 'nonws') && (l[i + 1].tag === 'nonws')) {
      throw l;
    }
  }
}

test('arbitrary parse input satisfies lexer invariants', () => {
  checkHarness(lexerInvariant, true);
});

test('arbitrary parse input with error satisfies lexer invariants', () => {
  checkHarnessWithError(lexerInvariant, true);
});

test('arbitrary tree without error parses', () => {
  checkHarness((s, l, r) => true);
});

test('arbitrary tree with error does not parse', () => {
  fc.assert(
    fc.property(
      arbTreeWithError,
      ([tree, inject]) => {
        const input = tree.toParseInputWithError(inject);
        if (input !== null) {
          try {
            expect(() => Array.from(parse(...input))).toThrowError();
          } catch (e) {
            throw new TagError(`${JSON.stringify(tree)}\n${input[0]}\n${JSON.stringify(input[1])}`, { cause: e });
          }
        }
      }
    ),
  );
});

test('only whitespace-only tree returns empty result', () => {
  checkHarness((_, l, r) => {
    expect(r.length === 0).toBe(l.filter(({ tag }) => tag === 'nonws').length === 0);
  });
});

test('output line numbers strictly increase', () => {
  checkHarness((s, l, r) => {
    let last = 0;
    for (const { linum } of r) {
      expect(linum).toBeGreaterThan(last);
      last = linum;
    }
  });
});

test('output lines within original string', () => {
  checkHarness((s, _, r) => {
    for (const { line: { start, end }} of r) {
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThanOrEqual(s.length);
    }
  });
});

test('output lines are nonempty', () => {
  checkHarness((s, l, r) => {
    for (const { line: { start, end }} of r ) {
      expect(end).toBeGreaterThan(start);
    }
  });
});

test('output line indices increase', () => {
  checkHarness((s, l, r) => {
    for (let i = 0; i < r.length - 1; i++) {
      expect(r[i + 1].line.start).toBeGreaterThanOrEqual(r[i].line.end);
    }
  });
});

test('first line starts at nesting 0', () => {
  checkHarness((s, l, r) => {
    if (r.length > 0) {
      expect(r[0].nesting).toBe(0);
    }
  });
});

test('nesting levels increase by at most 1', () => {
  checkHarness((s, l, r) => {
    for (let i = 0; i < r.length - 1; i++) {
      expect(r[i + 1].nesting).toBeLessThanOrEqual(r[i].nesting + 1);
    }
  });
});

test('every line with <nonws> produces output', () => {
  checkHarness((s, l, r) => {
    let i = 0, line = 1;
    for (const { linum } of r) {
      // count <nl> until first <nonws> reached
      while (i < l.length && l[i].tag !== 'nonws') {
        if (l[i].tag === 'nl') {
          line += 1;
        }
        i += 1;
      }

      expect(linum).toBe(line);

      // skip until next <nl>
      while (i < l.length && l[i].tag !== 'nl') {
        i += 1;
      }
    }
  });
});

test('label + mapping fit within line', () => {
  checkHarness((s, l, r) => {
    for (const { line: { start, end }, label, mapping } of r) {
      const len = label.length + (mapping?.length ?? 0);
      expect(len).toBeLessThanOrEqual(end - start);
    }
  });
});

test('label is the first <nonws> on output line', () => {
  checkHarness((s, l, r) => {
    let i = 0, line = 1;
    for (const { linum, label } of r) {
      // count <nl> until it matches output
      while (line < linum) {
        if (l[i].tag === 'nl') {
          line += 1;
        }
        i += 1;
      }

      // skip a line-starting <ws>
      if (l[i].tag === 'ws') {
        i += 1;
      }

      expect(label).toBe(s.substring(l[i].start, l[i].end));
    }
  });
});

test('mapping spans second <nonws> to last <nonws> of output line', () => {
  checkHarness((s, l, r) => {
    let i = 0, line = 1;
    for (const { linum, mapping } of r) {
      if (mapping === null) {
        continue;
      }

      // count <nl> until it matches output
      while (line < linum) {
        if (l[i].tag === 'nl') {
          line += 1;
        }
        i += 1;
      }

      // skip a line-starting <ws>?<nonws><ws>
      if (l[i].tag === 'ws') {
        i += 1;
      }
      i += 2;

      const start = l[i].start;
      let end = l[i].end;
      i += 1;
      while (i < l.length && l[i].tag !== 'nl') {
        if (l[i].tag === 'nonws') {
          end = l[i].end;
        }
        i += 1;
      }

      expect(mapping).toBe(s.substring(start, end));
    }
  });
});

type TreePredicate = (t:FakeTree, s:string, l:Token<Tag>[], r:TagMapping[]) => any;

function checkHarnessTreeImpl(tree: FakeTree, input: ParseInput, predicate: TreePredicate) {
  const [s, ll] = input;
  const l = Array.from(ll);
  try {
    const r = Array.from(parse(s, l));
    return predicate(tree, s, l, r);
  } catch (e) {
    throw new TagError(s + '\n' + JSON.stringify(l), { cause: e });
  }
}

function checkHarnessTree(predicate: TreePredicate) {
  fc.assert(
    fc.property(
      arbTreeMix,
      (tree) => checkHarnessTreeImpl(tree, tree.toParseInput(), predicate)
    ),
    { examples: [[ new FakeTree(null, [], false) ]] },
  );
}

function* walkSubtreeNesting(depth: number, tree: FakeNesting): Generator<number> {
  yield depth;
  if (tree.subtree !== null) {
    for (const child of tree.subtree.children) {
      yield* walkSubtreeNesting(depth + 1, child);
    }
  }
}

function* walkTreeNesting(tree: FakeTree): Generator<number> {
  for (const child of tree.toplevel) {
    yield* walkSubtreeNesting(0, child);
  }
}

test('nesting levels follow generated AST depth', () => {
  checkHarnessTree((tree, s, l, r) => {
    const depths = Array.from(walkTreeNesting(tree));
    expect(r.length).toBe(depths.length);
    for (let i = 0; i < r.length; i++) {
      expect(r[i].nesting).toBe(depths[i]);
    }
  });
});
