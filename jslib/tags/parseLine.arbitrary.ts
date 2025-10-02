// Copyright Jeffrey Tsang <jeffrey.tsang@ieee.org>
// GNU AGPL, 3.0 or later <https://www.gnu.org/licenses/agpl-3.0.html>

import fc from 'fast-check';
import type { Arbitrary } from 'fast-check';
import { type NatLT, type Tuple, devAssert } from '#util';
import type { Tag, Token } from '#tags/lexWsOnly';

const depthIdentifier = fc.createDepthIdentifier();

class FakeToken {
  str: string;
  tag: Tag;

  constructor(str: string, tag: Tag) {
    this.str = str;
    this.tag = tag;
  }
}

// <nl>, <ws>, <nonws> have different possible substring units, which have *faked* semantics, as parser should use lexer output
// Each mapping has both single/multi codepoint/codeunit occurrences.
function arbNl(maxLength: number): Arbitrary<FakeToken> {
  return fc.string({
    unit: fc.constantFrom('a', 'b', '\u1000', '\u1001', String.fromCodePoint(0x10300), String.fromCodePoint(0x10301), 'cd', '\u1002\u1003'),
    minLength: 1,
    maxLength: Math.max(Math.ceil(maxLength / 2), 2), // <nl> is half the length of other tokens
  }).map((s) => new FakeToken(s, 'nl'));
}

function arbWs(maxLength: number): Arbitrary<FakeToken> {
  return fc.string({
    unit: fc.constantFrom('e', 'f', '\u1010', '\u1011', String.fromCodePoint(0x10310), String.fromCodePoint(0x10311), 'gh', '\u1012\u1013'),
    minLength: 1,
    maxLength,
  }).map((s) => new FakeToken(s, 'ws'));
}

function arbNonws(maxLength: number): Arbitrary<FakeToken> {
  return fc.string({
    unit: fc.constantFrom('i', 'j', '\u1020', '\u1021', String.fromCodePoint(0x10320), String.fromCodePoint(0x10321), 'kl', '\u1022\u1023'),
    minLength: 1,
    maxLength,
  }).map((s) => new FakeToken(s, 'nonws'));
}

// Helper to accumulate generated AST to (raw string, lexer token stream) expected by parse()
class Accumulator {
  raw: string;
  tokens: Token<Tag>[];

  constructor() {
    this.raw = '';
    this.tokens = new Array();
  }

  appendToken(token: FakeToken) {
    const start = this.raw.length;
    this.raw += token.str;
    devAssert(this.raw.length > start);
    this.tokens.push({ tag: token.tag, start, end: this.raw.length });
  }

  // Used for specific constructed whitespace at start of line (including possible injected error)
  appendSpecificWs(str: string) {
    const start = this.raw.length;
    this.raw += str;
    devAssert(this.raw.length > start);
    this.tokens.push({ tag: 'ws', start, end: this.raw.length });
  }
}

// Represents one nonempty line (not including leading whitespace): <nonws>(<ws><nonws>)*<ws>?
class FakeLineTail {
  label: FakeToken;
  rest: [FakeToken, FakeToken][];
  trailing: FakeToken | null;

  constructor(label: FakeToken, rest: [FakeToken, FakeToken][], trailing: FakeToken | null) {
    this.label = label;
    this.rest = rest;
    this.trailing = trailing;
  }

  accumulateTo(acc: Accumulator) {
    acc.appendToken(this.label);
    for (let i = 0; i < this.rest.length; i++) {
      acc.appendToken(this.rest[i][0]);
      acc.appendToken(this.rest[i][1]);
    }
    if (this.trailing !== null) {
      acc.appendToken(this.trailing);
    }
  }
}

function arbLineTail(lineMax: number, tokenMax: number): Arbitrary<FakeLineTail> {
  return fc.tuple(
    arbNonws(tokenMax),
    fc.array(fc.tuple(arbWs(tokenMax), arbNonws(tokenMax)), { maxLength: lineMax, depthIdentifier }),
    fc.option(arbWs(tokenMax), { freq: 2 })
  ).map((d) => new FakeLineTail(...d));
}

// Represents a <nl>, with possible <ws>-only lines after: <nl>(<ws>?<nl>)*
// In particular, starts/ends with <nl>
class FakeLineBreak {
  first: FakeToken;
  rest: [FakeToken | null, FakeToken][];

  constructor(first: FakeToken, rest: [FakeToken | null, FakeToken][]) {
    this.first = first;
    this.rest = rest;
  }

  accumulateTo(acc: Accumulator) {
    acc.appendToken(this.first);
    for (const [ws, nl] of this.rest) {
      if (ws !== null) {
        acc.appendToken(ws);
      }
      acc.appendToken(nl);
    }
  }
}

function arbLineBreak(lineMax: number, tokenMax: number): Arbitrary<FakeLineBreak> {
  return fc.tuple(
    arbNl(tokenMax),
    fc.array(
      fc.tuple(fc.option(arbWs(tokenMax), { freq: 2 }), arbNl(tokenMax)),
      { maxLength: lineMax, depthIdentifier }
    )
  ).map((d) => new FakeLineBreak(...d));
}

// <ws> prefix for this level that is cumulative with those of ancestors, if children exist
type FakeSubtree = null | { prefix: FakeToken, children: FakeNesting[] }

// Represents a subtree including all children
export class FakeNesting {
  line: FakeLineTail;
  post: FakeLineBreak;
  subtree: FakeSubtree;

  constructor(line: FakeLineTail, post: FakeLineBreak, subtree: FakeSubtree = null) {
    this.line = line;
    this.post = post;
    this.subtree = subtree;
  }

  childCount(): number {
    if (this.subtree === null) {
      return 0;
    }
    devAssert(this.subtree.children.length > 0);
    return this.subtree.children.length;
  }

  childAt(index: number): FakeNesting {
    devAssert(this.subtree !== null);
    return this.subtree.children[index];
  }

  // Callback: total prefix, the child, is the last child, is selected for error injection
  forEachChild(wsPrefix: string, errorPlace: number | null, callback: (p:string, c:FakeNesting, l:boolean, e:boolean) => any) {
    if (this.subtree !== null) {
      const totalPrefix = wsPrefix + this.subtree.prefix.str;
      const lastChild = this.childCount() - 1;

      this.subtree.children.forEach((child, i) =>
        callback(
          totalPrefix,
          child,
          i === lastChild,
          errorPlace !== null && i === errorPlace
        ));
    }
  }

  // Returns whether an error was actually injected
  accumulateTo(
    acc: Accumulator,
    wsPrefix: string, // total line prefix of all ancestor strings
    dropLast: boolean = false, // whether to ignore the <post> of the very last nonempty line
    injectError: Iterator<number> | null = null, // random stream of numbers to choose a location to inject a leading <ws> error
  ): boolean {
    // the prefix of this subtree root is handled by the recursive parent call
    this.line.accumulateTo(acc);
    // dropLast applies if there are no children
    if (!(dropLast && this.childCount() === 0)) {
      this.post.accumulateTo(acc);
    }

    let errorPlace: number | null = null, errorPropagate = false, errorSuccess = false;
    if (this.childCount() > 1) {
      // an error (<ws> mismatch on same level of nesting) only possible with 2+ siblings
      const roll = injectError?.next()?.value ?? null;
      if (roll !== null) {
        errorPlace = roll % this.childCount();

        if (this.childAt(errorPlace).childCount() > 1) {
          // with a valid choice inside the child subtree, choose whether to propagate the error injection deeper
          const roll = injectError?.next()?.value /* v8 ignore next */ ?? null;
          if (roll !== null) {
            // 1/4 chance of choosing to apply the error to the child root's leading <ws> directly (here) anyway
            errorPropagate = (roll % 4) !== 0;
          }
        }
      }
    }

    this.forEachChild(wsPrefix, errorPlace, (prefix, child, isLast, isError) => {
      // handle prefix for child
      if (isError && !errorPropagate) {
        devAssert(prefix.length > 0); // must be in a subtree
        let index = injectError?.next()?.value /* v8 ignore next */ ?? null;
        // place strictly before end of string to prevent any prefix match
        /* v8 ignore start */
        if (index === null) {
          index = prefix.length - 1; /* v8 ignore stop */
        } else {
          index %= prefix.length;
        }
        // insert a single '!' character, which never exists in a <ws> token otherwise
        // do not corrupt prefix as other children use it
        acc.appendSpecificWs(prefix.substring(0, index) + '!' + prefix.substring(index));
        errorSuccess = true;
      } else {
        acc.appendSpecificWs(prefix);
      }

      errorSuccess = child.accumulateTo(
        acc,
        prefix,
        dropLast && isLast, // propagate dropLast only for last child
        (isError && errorPropagate) ? injectError : null, // propagate injectError only in specific child if chosen
      ) || errorSuccess; // always evaluate child
    });

    return errorSuccess;
  }
}

function arbNesting(maxDepth: number, childMax: number, lineMax: number, tokenMax: number): Arbitrary<FakeNesting> {
  return fc.letrec((r) => ({
    nest: fc.tuple(
      arbLineTail(lineMax, tokenMax),
      arbLineBreak(lineMax, tokenMax),
      fc.option(
        fc.record({
          prefix: arbWs(tokenMax),
          children: fc.array(r('nest') as Arbitrary<FakeNesting>, { minLength: 1, maxLength: childMax, depthIdentifier })
        }),
        { freq: 4, maxDepth, depthSize: 'max', depthIdentifier }
      )
    ).map((x) => new FakeNesting(...x)),
  })).nest;
}

// Prefix of the entire file; since FakeLineBreak starts/ends with <nl>, allow very start of file to be <ws>
type FakeFilePrefix = null | FakeLineBreak | [FakeToken, FakeLineBreak];

// Represents an entire parse tree
export class FakeTree {
  prefix: FakeFilePrefix;
  toplevel: FakeNesting[];
  dropLast: boolean; // FakeNesting also eventually ends with <nl>, allow very end of file to not have linebreaks by ignoring it

  constructor(prefix: FakeFilePrefix, toplevel: FakeNesting[], dropLast: boolean) {
    this.prefix = prefix;
    this.toplevel = toplevel;
    this.dropLast = dropLast;
  }

  // injectError: random stream of numbers to choose a location to inject a leading <ws> error (invalid input)
  // Returns whether an error was actually injected
  accumulateTo(acc: Accumulator, injectError: Iterator<number> | null = null): boolean {
    if (this.prefix !== null) {
      if (Array.isArray(this.prefix)) {
        const [ws, lineBreak] = this.prefix;
        acc.appendToken(ws);
        lineBreak.accumulateTo(acc);
      } else {
        // typeof prefix === FakeLineBreak
        this.prefix.accumulateTo(acc);
      }
    }

    let errorPlace: number | null = null, errorPropagate = false, errorSuccess = false;
    if (this.toplevel.length > 0) {
      // an error at top-level is possible even with 1 child; very first line must have no leading <ws>
      for (let tries = 0; tries < 5 && errorPlace === null; tries += 1) {
        const roll = injectError?.next()?.value ?? null;
        if (roll !== null) {
          errorPlace = roll % this.toplevel.length;

          // if previous top-level had zero children, injecting a leading <ws> actually looks like nesting,
          // which therefore requires the chosen top-level to itself have children (to mismatch <ws>)
          const toplevelInvalid = errorPlace > 0 &&
            this.toplevel[errorPlace - 1].childCount() === 0 &&
            this.toplevel[errorPlace].childCount() === 0;

          if (this.toplevel.length > 1 && this.toplevel[errorPlace].childCount() > 1) {
            // with a valid choice inside the child subtree, choose whether to propagate the error injection deeper
            const roll = injectError?.next()?.value /* v8 ignore next */ ?? null;
            if (roll !== null) {
              // 1/4 chance of choosing to apply the error to the child root's leading <ws> directly (here) anyway
              errorPropagate = toplevelInvalid || ((roll % 4) !== 0);
            }
          }

          if (toplevelInvalid && !errorPropagate) {
            // give up on this error injection
            errorPlace = null;
          }
        }
      }
    }

    this.toplevel.forEach((child, i) => {
      // only time a prefix is inserted at top-level is an error
      if (errorPlace === i && !errorPropagate) {
        acc.appendSpecificWs('!');
        errorSuccess = true;
      }

      errorSuccess = child.accumulateTo(
        acc,
        '', // no prefix from top-level
        this.dropLast && i === this.toplevel.length - 1, // propagate dropLast only for last child
        (errorPlace === i && errorPropagate) ? injectError : null, // propagate injectError only in specific child if chosen
      ) || errorSuccess; // always evaluate child
    });

    return errorSuccess;
  }

  toParseInput(): ParseInput {
    const acc = new Accumulator();
    devAssert(!this.accumulateTo(acc, null));
    return [this, acc.raw, acc.tokens];
  }

  // Returns null if error injection failed
  toParseInputWithError(injectError: Iterator<number>): ParseInput | null {
    const acc = new Accumulator();
    if (this.accumulateTo(acc, injectError)) {
      return [this, acc.raw, acc.tokens];
    }
    return null;
  }
}

function arbTree(maxDepth: number, childMax: number, lineMax: number, tokenMax: number): Arbitrary<FakeTree> {
  return fc.tuple(
    fc.oneof(
      fc.constant(null),
      arbLineBreak(lineMax, tokenMax),
      fc.tuple(arbWs(tokenMax), arbLineBreak(lineMax, tokenMax))
    ),
    fc.array(arbNesting(maxDepth - 1, childMax, lineMax, tokenMax), { maxLength: childMax, depthIdentifier }),
    fc.boolean(),
  ).map((x) => new FakeTree(...x));
}

// Mix of different tree shapes (wider vs deeper, etc)
const arbTreeMix: Arbitrary<FakeTree> = fc.oneof(arbTree(6, 6, 6, 6), arbTree(10, 4, 6, 6), arbTree(4, 10, 6, 6), arbTree(4, 4, 10, 10));
const arbError: Arbitrary<Iterator<number>> = fc.infiniteStream(fc.maxSafeNat());
const arbTreeWithError: Arbitrary<[FakeTree, Iterator<number>]> = fc.tuple(arbTreeMix, arbError);

export type ParseInput = [FakeTree, string, Token<Tag>[]];

export const arbInput: Arbitrary<ParseInput> = arbTreeMix.map((t) => t.toParseInput());
export const arbInputWithError: Arbitrary<ParseInput> = arbTreeWithError.map(([t, e]) => t.toParseInputWithError(e)).filter((x) => x !== null);
