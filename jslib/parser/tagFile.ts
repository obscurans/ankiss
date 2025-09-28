import { devAssert, exhaustive } from '#util';
import { lex, type Tag } from '#lexer/wsOnly';
import type { LexStream } from '#lexer';

export class TagError extends Error {
  constructor(message: string, options?: { cause: any }) {
    super(message, options);
    this.name = 'TagError';
  }
}

export interface TagMapping {
  linum: number,
  line: { start: number, end: number }, // substring index for the line in raw string
  nesting: number, // nesting level of this mapping
  label: string,
  mapping: string | null,
}

export type MappingStream = Iterable<TagMapping>;

interface LineBreak {
  state: 'LineBreak'; // last seen line component
}

interface BeginWs {
  state: 'BeginWs';
}

interface Label {
  state: 'Label';
  nesting: number;
  label: string;
}

interface LabelWs {
  state: 'LabelWs';
  nesting: number;
  label: string;
  mappingStart: number;
}

interface Mapping {
  state: 'Mapping';
  nesting: number;
  label: string;
  mappingStart: number;
  mappingEnd: number; // current end of mapping (before whitespace)
}

interface MappingWs {
  state: 'MappingWs';
  nesting: number;
  label: string;
  mappingStart: number;
  mappingEnd: number; // current end of mapping (before whitespace)
}

type State = LineBreak | BeginWs | Label | LabelWs | Mapping | MappingWs;

// Given a stream of wsOnly:Token<Tag>s (<nl>|<ws>|<nonws>, no 2 adjacent <ws> / 2 adjacent <nonws>), with raw string,
// parses it into individual nonempty lines
//
// Lines that contain only whitespace are ignored
// Leading <ws> is used for nesting level
// - top-level is no leading whitespace
// - very first nonempty line must be top-level (else throws)
// - any increase in whitespace (full prefix match) increases nesting
// - inconsistent whitespace (not a match to a previous nesting level) throws
// First <nonws> is extracted as 'label'
// Span between second <nonws> and last <nonws> in the line, inclusive, is extracted as 'mapping'
// Trailing <ws> always ignored
export function* parse(str: string, tags: LexStream<Tag>): MappingStream {
  let linum = 1, lineStart = 0, s = { state: 'LineBreak' } as State;
  // whitespace prefixes to current nesting level (including top-level)
  // empty is sentinel for "never seen a nonempty line", since very first mapping must be top-level
  const wsStack = new Array();

  function hasLabel() {
    return s.state !== 'LineBreak' && s.state !== 'BeginWs';
  }
  function marshal(end: number) {
    devAssert(s.state !== 'LineBreak' && s.state !== 'BeginWs');
    return {
      linum,
      line: { start: lineStart, end },
      nesting: s.nesting,
      label: s.label,
      mapping: (s.state === 'Mapping' || s.state === 'MappingWs') ? str.substring(s.mappingStart, s.mappingEnd) : null,
    };
  }

  for (const { tag, start, end } of tags) {
    function throwError(msg: string, cause?: any) {
      throw new TagError(`${msg} at line {${linum}}: {${str.substring(lineStart, end)}}`, { cause });
    }

    function computeNesting(): number {
      if (!wsStack.length) {
        throwError('First nonempty line must be a top-level tag (with no leading whitespace)');
      }

      // since this is triggered on the <nonws> token following leading <ws>, goes up to start of current token
      const ws = str.substring(lineStart, start);
      if (ws.startsWith(wsStack[wsStack.length - 1])) {
        if (ws !== wsStack[wsStack.length - 1]) {
          // new nesting level
          wsStack.push(ws);
        }
      } else {
        // find next exact match of ws in wsStack
        while (ws !== wsStack[wsStack.length - 1]) {
          // must throw before wsStack empties as its first entry must be '', while ws is nonempty
          if (ws.length >= wsStack[wsStack.length - 1].length) {
            throwError(`Inconsistent whitespace at nesting level ${wsStack.length}`);
          }
          wsStack.pop();
        }
      }
      return wsStack.length - 1;
    }

    switch (tag) {
      case 'nl':
        if (hasLabel()) {
          yield marshal(end);
        }

        linum += 1;
        lineStart = end;
        s = { state: 'LineBreak' };
        break;
      case 'ws':
        switch (s.state) {
          case 'LineBreak':
            // defer handling nesting level until line proves nonempty
            s = { ...s, state: 'BeginWs' };
            break;
          case 'Label':
            s = { ...s, state: 'LabelWs', mappingStart: end };
            break;
          case 'Mapping':
            // ignore possibly-trailing <ws> for now
            s = { ...s, state: 'MappingWs' };
            break;
          /* v8 ignore next */ default: devAssert(false);
        }
        break;
      case 'nonws':
        switch (s.state) {
          case 'LineBreak':
            // new top-level tag, reset stack
            wsStack.length = 0;
            wsStack.push('');

            s = { ...s,
              state: 'Label',
              nesting: 0,
              label: str.substring(start, end),
            };
            break;
          case 'BeginWs':
            s = { ...s,
              state: 'Label',
              nesting: computeNesting(),
              label: str.substring(start, end),
            };
            break;
          case 'LabelWs':
          case 'MappingWs':
            s = { ...s,
              state: 'Mapping',
              mappingEnd: end, // update end index with current last <nonws>
            };
            break;
          /* v8 ignore next */ default: devAssert(false);
        }
        break;
      /* v8 ignore next */ default: exhaustive(tag);
    }
  }

  if (hasLabel()) {
    yield marshal(str.length);
  }

  return;
}

// Convenience function to use wsOnly lexer
export function parseDefault(str: string): MappingStream {
  return parse(str, lex(str));
}
