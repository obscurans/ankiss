// Copyright Jeffrey Tsang <jeffrey.tsang@ieee.org>
// GNU AGPL, 3.0 or later <https://www.gnu.org/licenses/agpl-3.0.html>

import { expect, test } from 'vitest';
import fc from 'fast-check';
import { lex, type Tag } from '#tags/lexWsOnly';
import type { Token } from '#types';

function checkHarness(predicate: (s:string, r:Token<Tag>[]) => any) {
  fc.assert(
    fc.property(
      fc.string({ unit: 'binary' }),
      (s) => predicate(s, Array.from(lex(s)))
    ),
    { examples: [['']] },
  );
}

test('only empty string returns empty result', () => {
  checkHarness((s, r) => {
    expect(r.length === 0).toBe(s.length === 0);
  });
});

test('first token starts at 0', () => {
  checkHarness((_, r) => {
    if (r.length > 0) {
      expect(r[0].start).toBe(0);
    }
  });
});

test('adjacent tokens are contiguous', () => {
  checkHarness((_, r) => {
    for (let i = 0; i < r.length - 1; i++) {
      expect(r[i].end).toBe(r[i + 1].start);
    }
  });
});

test('last token ends at end of input', () => {
  checkHarness((s, r) => {
    if (r.length > 0) {
      expect(r[r.length - 1].end).toBe(s.length);
    }
  });
});

test('all tokens nonempty', () => {
  checkHarness((_, r) => {
    r.forEach(({ start, end }) => {
      expect(end).toBeGreaterThan(start);
    });
  });
});

test('adjacent <ws> tokens never appear', () => {
  checkHarness((_, r) => {
    for (let i = 0; i < r.length - 1; i++) {
      if ((r[i].tag === 'ws') && (r[i + 1].tag === 'ws')) {
        throw r;
      }
    }
  });
});

test('adjacent <nonws> tokens never appear', () => {
  checkHarness((_, r) => {
    for (let i = 0; i < r.length - 1; i++) {
      if ((r[i].tag === 'nonws') && (r[i + 1].tag === 'nonws')) {
        throw r;
      }
    }
  });
});

test('all <nl> tokens are length 1 except \\r\\n', () => {
  checkHarness((s, r) => {
    r.filter(({ tag }) => tag === 'nl')
      .forEach(({ start, end }) => {
        if (end === start + 2) {
          expect(s.substring(start, end)).toBe('\r\n');
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
        const s = s1 + force + s2;
        return predicate(s, s1.length, Array.from(lex(s)))
      }
    ),
  );
}

function checkSpecificToken(force: string, expected: Tag) {
  return checkHarnessForce(force, (s, i, r) => {
    expect(r.filter(({ tag, start, end }) => tag === expected && start === i && end === i + force.length)
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
  return checkHarnessForce(force, (s, i, r) => {
    expect(r.filter(({ tag, start, end }) => tag === expected && start <= i && end >= i + force.length)
      .length).toBe(1);
  });
}

test.for([
  ['\\r', '\r'],
  ['\\n', '\n']])(
    '%s classified as <nl>', ([, s]) => checkWithinToken(s, 'nl'));

test('\\r and \\n are never consecutive tokens', () => {
  checkHarnessForce('\r\n', (s, _, r) => {
    for (let i = 0; i < r.length - 1; i++) {
      if (s.substring(r[i].start, r[i].end) === '\r' && s.substring(r[i + 1].start, r[i + 1].end) === '\n') {
        throw r;
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
        const f = String.fromCodePoint(n);
        const s = s1 + f + s2;
        return predicate(f, s, s1.length, Array.from(lex(s)))
      }
    ),
  );
}

// force is a range of Unicode code points
function checkWithinTokenRange(force: { low: number, high: number }, expected: Tag) {
  return checkHarnessRange(force, (f, _, i, r) => {
    expect(r.filter(({ tag, start, end }) => tag === expected && start <= i && end >= i + f.length)
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
