// Copyright Jeffrey Tsang <jeffrey.tsang@ieee.org>
// GNU AGPL, 3.0 or later <https://www.gnu.org/licenses/agpl-3.0.html>

import { expect, test } from 'vitest';
import fc from 'fast-check';
import type { Arbitrary } from 'fast-check';
import { parse, TagError, type TagMapping } from '#tags/parseLine';
import { arbInput, arbInputWithError, FakeTree, FakeNesting, type ParseInput } from '#tags/parseLine.arbitrary';
import type { Token, Tag } from '#tags/lexWsOnly';

test('empty tree parses as empty', () => {
  const [tree, str, lexOut] = new FakeTree(null, [], false).toParseInput();
  expect(str).toBe('');
  expect(lexOut).toEqual([]);
  const result = Array.from(parse(str, lexOut));
  expect(result).toEqual([]);
});

function lexerInvariant(str: string, lexOut: Token<Tag>[]) {
  if (lexOut.length > 0) {
    expect(lexOut[0].start).toBe(0);
    expect(lexOut[lexOut.length - 1].end).toBe(str.length);
  }

  lexOut.forEach(({ start, end }) => {
    expect(end).toBeGreaterThan(start);
  });

  for (let i = 0; i < lexOut.length - 1; i++) {
    expect(lexOut[i].end).toBe(lexOut[i + 1].start);
    if ((lexOut[i].tag === 'ws') && (lexOut[i + 1].tag === 'ws')) {
      throw lexOut;
    } else if ((lexOut[i].tag === 'nonws') && (lexOut[i + 1].tag === 'nonws')) {
      throw lexOut;
    }
  }
}

test('arbitrary parse input satisfies lexer invariants', () => {
  fc.assert(
    fc.property(
      arbInput,
      ([_tree, str, lexOut]) => lexerInvariant(str, lexOut)
    ),
    { examples: [[ [new FakeTree(null, [], false), '', []] ]]}
  );
});

function checkHarnessWithError(predicate: (s:string, l:Token<Tag>[]) => any, numRuns: number | undefined = undefined) {
  fc.assert(
    fc.property(
      arbInputWithError,
      ([_tree, str, lexOut]) => predicate(str, lexOut)
    ),
    { numRuns },
  );
}

test('arbitrary parse input with error satisfies lexer invariants', () => {
  checkHarnessWithError(lexerInvariant);
});

test('arbitrary tree with error does not parse', () => {
  checkHarnessWithError(
    (str, lexOut) => { expect(() => Array.from(parse(str, lexOut))).toThrowError(); },
    200);
});

const arbResult: Arbitrary<[FakeTree, string, Token<Tag>[], TagMapping[]]> =
      arbInput.map(([tree, str, lexOut]) => [tree, str, lexOut, Array.from(parse(str, lexOut))]);

function checkHarness(predicate: (t:FakeTree, s:string, l:Token<Tag>[], r:TagMapping[]) => any) {
  fc.assert(
    fc.property(arbResult, (d) => predicate(...d)),
  );
}

test('arbitrary tree without error parses', () => {
  checkHarness((_tree, _str, lexOut, _result) => true);
});

test('only whitespace-only tree returns empty result', () => {
  checkHarness((_tree, _str, lexOut, result) => {
    expect(result.length === 0).toBe(lexOut.filter(({ tag }) => tag === 'nonws').length === 0);
  });
});

test('output line numbers strictly increase', () => {
  checkHarness((_tree, _str, lexOut, result) => {
    let last = 0;
    for (const { linum } of result) {
      expect(linum).toBeGreaterThan(last);
      last = linum;
    }
  });
});

test('output lines within original string', () => {
  checkHarness((_tree, str, _lexOut, result) => {
    for (const { line: { start, end }} of result) {
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThanOrEqual(str.length);
    }
  });
});

test('output lines are nonempty', () => {
  checkHarness((_tree, _str, _lexOut, result) => {
    for (const { line: { start, end }} of result) {
      expect(end).toBeGreaterThan(start);
    }
  });
});

test('output line indices increase', () => {
  checkHarness((_tree, _str, _lexOut, result) => {
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i + 1].line.start).toBeGreaterThanOrEqual(result[i].line.end);
    }
  });
});

test('first line starts at nesting 0', () => {
  checkHarness((_tree, _str, _lexOut, result) => {
    if (result.length > 0) {
      expect(result[0].nesting).toBe(0);
    }
  });
});

test('nesting levels increase by at most 1', () => {
  checkHarness((_tree, _str, _lexOut, result) => {
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i + 1].nesting).toBeLessThanOrEqual(result[i].nesting + 1);
    }
  });
});

test('every line with <nonws> produces output', () => {
  checkHarness((_tree, _str, lexOut, result) => {
    let i = 0, line = 1;
    for (const { linum } of result) {
      // count <nl> until first <nonws> reached
      while (i < lexOut.length && lexOut[i].tag !== 'nonws') {
        if (lexOut[i].tag === 'nl') {
          line += 1;
        }
        i += 1;
      }

      expect(linum).toBe(line);

      // skip until next <nl>
      while (i < lexOut.length && lexOut[i].tag !== 'nl') {
        i += 1;
      }
    }
  });
});

test('label + mapping fit within line', () => {
  checkHarness((_tree, _str, _lexOut, result) => {
    for (const { line: { start, end }, label, mapping } of result) {
      const len = label.length + (mapping?.length ?? 0);
      expect(len).toBeLessThanOrEqual(end - start);
    }
  });
});

test('label is the first <nonws> on output line', () => {
  checkHarness((_tree, str, lexOut, result) => {
    let i = 0, line = 1;
    for (const { linum, label } of result) {
      // count <nl> until it matches output
      while (line < linum) {
        if (lexOut[i].tag === 'nl') {
          line += 1;
        }
        i += 1;
      }

      // skip a line-starting <ws>
      if (lexOut[i].tag === 'ws') {
        i += 1;
      }

      expect(label).toBe(str.substring(lexOut[i].start, lexOut[i].end));
    }
  });
});

test('mapping spans second <nonws> to last <nonws> of output line', () => {
  checkHarness((_tree, str, lexOut, result) => {
    let i = 0, line = 1;
    for (const { linum, mapping } of result) {
      if (mapping === null) {
        continue;
      }

      // count <nl> until it matches output
      while (line < linum) {
        if (lexOut[i].tag === 'nl') {
          line += 1;
        }
        i += 1;
      }

      // skip a line-starting <ws>?<nonws><ws>
      if (lexOut[i].tag === 'ws') {
        i += 1;
      }
      i += 2;

      const start = lexOut[i].start;
      let end = lexOut[i].end;
      i += 1;
      while (i < lexOut.length && lexOut[i].tag !== 'nl') {
        if (lexOut[i].tag === 'nonws') {
          end = lexOut[i].end;
        }
        i += 1;
      }

      expect(mapping).toBe(str.substring(start, end));
    }
  });
});

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
  checkHarness((tree, _str, _lexOut, result) => {
    const depths = Array.from(walkTreeNesting(tree));
    expect(result.length).toBe(depths.length);
    for (let i = 0; i < result.length; i++) {
      expect(result[i].nesting).toBe(depths[i]);
    }
  });
});
