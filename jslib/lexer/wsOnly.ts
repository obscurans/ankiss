import type { LexStream } from 'lexer';

export type Tag = 'nl' | 'ws' | 'nonws';

export function* lex(str: string): LexStream<Tag> {
  // Single newline, maximal other whitespace, or maximal other chars; irrefutable
  // Newline per unicode standard 5.8; whitespace per unicode White_Space
  // \v is, per main standard, considered whitespace but not newline
  // \x85 is considered newline; doesn't match JS regex
  const re_lexer = /(?<nl>\r\n|[\n\f\r\x85\u2028\u2029])|(?<ws>[\p{White_Space}--[\n\f\r\x85\u2028\u2029]]+)|(?<nonws>\P{White_Space}+)/vy;

  let last = 0, match: any;
  while ((match = re_lexer.exec(str)) !== null) {
    function tag() {
      const g = match.groups!;
      if (g.nl !== void 0) {
        return 'nl';
      } else if (g.ws !== void 0) {
        return 'ws';
      } else if (import.meta.env.PROD || g.nonws !== void 0) {
        // Regex is irrefutable, see tests for proof.
        return 'nonws';
      /* v8 ignore next */ }
      throw 'Unreachable';
    }

    yield {
      tag: tag(),
      start: last,
      end: re_lexer.lastIndex,
    };

    last = re_lexer.lastIndex;
  }
  return;
}
