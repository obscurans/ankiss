// Copyright Jeffrey Tsang <jeffrey.tsang@ieee.org>
// GNU AGPL, 3.0 or later <https://www.gnu.org/licenses/agpl-3.0.html>

import { expect, test } from 'vitest';
import fc from 'fast-check';
import type { Arbitrary } from 'fast-check';
import { lex, type Tag, type Token } from '#tags/lexWsOnly';

test('empty string returns empty result', () => {
  expect(Array.from(lex(''))).toEqual([]);
});

const arbLexResult: Arbitrary<[string, Token<Tag>[]]> = fc.string({ unit: 'binary' }).map((s) => [s, Array.from(lex(s))]);

function checkHarness(predicate: (s:string, r:Token<Tag>[]) => any) {
  fc.assert(
    fc.property(arbLexResult, (d) => predicate(...d)),
    { examples: [[ ['', []] ]]},
  );
}

test('only empty string returns empty result', () => {
  checkHarness((str, result) => {
    expect(result.length === 0).toBe(str.length === 0);
  });
});

test('first token starts at 0', () => {
  checkHarness((_str, result) => {
    if (result.length > 0) {
      expect(result[0].start).toBe(0);
    }
  });
});

test('adjacent tokens are contiguous', () => {
  checkHarness((_str, result) => {
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].end).toBe(result[i + 1].start);
    }
  });
});

test('last token ends at end of input', () => {
  checkHarness((str, result) => {
    if (result.length > 0) {
      expect(result[result.length - 1].end).toBe(str.length);
    }
  });
});

test('all tokens nonempty', () => {
  checkHarness((_str, result) => {
    result.forEach(({ start, end }) => {
      expect(end).toBeGreaterThan(start);
    });
  });
});

test('adjacent <ws> tokens never appear', () => {
  checkHarness((_str, result) => {
    for (let i = 0; i < result.length - 1; i++) {
      if ((result[i].tag === 'ws') && (result[i + 1].tag === 'ws')) {
        throw result;
      }
    }
  });
});

test('adjacent <nonws> tokens never appear', () => {
  checkHarness((_str, result) => {
    for (let i = 0; i < result.length - 1; i++) {
      if ((result[i].tag === 'nonws') && (result[i + 1].tag === 'nonws')) {
        throw result;
      }
    }
  });
});

test('all <nl> tokens are length 1 except \\r\\n', () => {
  checkHarness((str, result) => {
    result.filter(({ tag }) => tag === 'nl')
      .forEach(({ start, end }) => {
        if (end === start + 2) {
          expect(str.substring(start, end)).toBe('\r\n');
        } else {
          expect(end).toBe(start + 1);
        }
      });
  });
});

function checkHarnessForce(force: string, predicate: (s:string, i:number, r:Token<Tag>[]) => any) {
  fc.assert(
    fc.property(
      fc.string({ unit: 'binary' }),
      fc.string({ unit: 'binary' }),
      (s1, s2) => {
        const str = s1 + force + s2;
        return predicate(str, s1.length, Array.from(lex(str)))
      }
    ),
  );
}

function checkSpecificToken(force: string, expected: Tag) {
  return checkHarnessForce(force, (_str, idx, result) => {
    expect(result.filter(({ tag, start, end }) => tag === expected && start === idx && end === idx + force.length)
      .length).toBe(1);
  });
}

test.for([
  ['\\f', '\f'],
  ['\\x85', '\x85'],
  ['\\u2028', '\u2028'],
  ['\\u2029', '\u2029'],
  ['\\r\\n', '\r\n']])(
    '%s is a single <nl> token', ([, s]) => checkSpecificToken(s, 'nl'));

function checkWithinToken(force: string, expected: Tag) {
  return checkHarnessForce(force, (_str, idx, result) => {
    expect(result.filter(({ tag, start, end }) => tag === expected && start <= idx && end >= idx + force.length)
      .length).toBe(1);
  });
}

test.for([
  ['\\r', '\r'],
  ['\\n', '\n']])(
    '%s classified as <nl>', ([, s]) => checkWithinToken(s, 'nl'));

test('\\r and \\n are never consecutive tokens', () => {
  checkHarnessForce('\r\n', (str, _idx, result) => {
    for (let i = 0; i < result.length - 1; i++) {
      if (str.substring(result[i].start, result[i].end) === '\r' && str.substring(result[i + 1].start, result[i + 1].end) === '\n') {
        throw result;
      }
    }
  });
});

test.for([
  ['\\t', '\t'],
  ['space', ' '],
  ['\\xA0', '\xA0'],
  ['\\u1680', '\u1680'],
  ['\\u202F', '\u202F'],
  ['\\u205F', '\u205F'],
  ['\\u3000', '\u3000']])(
    '%s classified as <ws>', ([, s]) => checkWithinToken(s, 'ws'));

function checkHarnessRange(force: { low: number, high: number }, predicate: (f:string, s:string, i:number, r:Token<Tag>[]) => any) {
  fc.assert(
    fc.property(
      fc.string({ unit: 'binary' }),
      fc.integer({ min: force.low, max: force.high }),
      fc.string({ unit: 'binary' }),
      (s1, n, s2) => {
        const forced = String.fromCodePoint(n);
        const str = s1 + forced + s2;
        return predicate(forced, str, s1.length, Array.from(lex(str)))
      }
    ),
  );
}

// force is a range of Unicode code points
function checkWithinTokenRange(force: { low: number, high: number }, expected: Tag) {
  return checkHarnessRange(force, (forced, _str, idx, result) => {
    expect(result.filter(({ tag, start, end }) => tag === expected && start <= idx && end >= idx + forced.length)
      .length).toBe(1);
  });
}

test('\\u2000-\\u200A classified as <ws>', () => {
  checkWithinTokenRange({ low: 0x2000, high: 0x200A }, 'ws');
});

test.for([
  ['\\x00', '\\x08', 0, 8],
  ['\\x0E', '\\x1F', 0x0E, 0x1F],
  ['!(\\x21)', '\\x84', 0x21, 0x84],
  ['\\x86', '\\x9F', 0x86, 0x9F],
  ['\\xA1', '\\u167F', 0xA1, 0x167F],
  ['\\u1681', '\\u1FFF', 0x1681, 0x1FFF],
  ['\\u200B', '\\u2027', 0x200B, 0x2027],
  ['\\u202A', '\\u202E', 0x202A, 0x202E],
  ['\\u2030', '\\u205E', 0x2030, 0x205E],
  ['\\u2060', '\\u2FFF', 0x2060, 0x2FFF],
  ['\\u3001', '\\uD7FF', 0x3001, 0xD7FF],
  ['\\uD800', '\\uDFFF', 0xD800, 0xDFFF],
  ['\\uE000', '\\uFFFF', 0xE000, 0xFFFF],
  ['\\u{10000}', '\\u{10FFFF}', 0x10000, 0x10FFFF]] as const)(
    '%s-%s classified as <nonws>', ([,, low, high]) => checkWithinTokenRange({ low, high }, 'nonws'));
