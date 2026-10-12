import type { Element } from "hast";
import type { CompileContext, Extension as FromMarkdownExtension, Token } from "mdast-util-from-markdown";
import type { InlineMath } from "mdast-util-math";
import type {
  Code,
  Construct,
  Effects,
  State,
  Extension as SyntaxExtension,
  TokenizeContext,
} from "micromark-util-types";
import type { Processor } from "unified";

declare module "micromark-util-types" {
  interface TokenTypeMap {
    texMathInline: "texMathInline";
    texMathDisplay: "texMathDisplay";
    texMathSequence: "texMathSequence";
    texMathData: "texMathData";
  }
}

const BACKSLASH = 92;

/**
 * Math written the LaTeX way, as models often do: `\(…\)` inline and `\[…\]` displayed. remark-math reads only
 * dollar signs. Both forms read as inline math nodes, so `\[…\]` may sit in a paragraph and span its lines. Inside the
 * math, a backslash and the character after it stay together, so `\\)` does not close it. Code is untouched, being
 * parsed before text.
 */
export function texDelimiters(this: Processor): void {
  const data = this.data();
  data.micromarkExtensions ??= [];
  data.fromMarkdownExtensions ??= [];
  data.micromarkExtensions.push(syntax);
  data.fromMarkdownExtensions.push(fromMarkdown);
}

const syntax: SyntaxExtension = {
  text: { [BACKSLASH]: [delimited("texMathInline", "(", ")"), delimited("texMathDisplay", "[", "]")] },
};

function delimited(type: "texMathInline" | "texMathDisplay", open: string, close: string): Construct {
  const opening = open.charCodeAt(0);
  const closing = close.charCodeAt(0);
  const end: Construct = { partial: true, tokenize: tokenizeEnd };
  return { name: type, tokenize };

  function tokenize(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
    let inData = false;
    let seen = false;
    return start;

    function start(code: Code): State | undefined {
      effects.enter(type);
      effects.enter("texMathSequence");
      effects.consume(code);
      return afterBackslash;
    }

    function afterBackslash(code: Code): State | undefined {
      if (code !== opening) return nok(code);
      effects.consume(code);
      effects.exit("texMathSequence");
      return inside;
    }

    function inside(code: Code): State | undefined {
      if (code === null) return nok(code);
      if (code === BACKSLASH) return effects.check(end, closeHere, escaped)(code);
      // Line endings are tokens of their own, as in inline code; the Markdown tree turns them back into text.
      if (isLineEnding(code)) {
        exitData();
        effects.enter("lineEnding");
        effects.consume(code);
        effects.exit("lineEnding");
        return inside;
      }
      enterData();
      effects.consume(code);
      return inside;
    }

    function escaped(code: Code): State | undefined {
      enterData();
      effects.consume(code);
      return escapedCharacter;
    }

    function escapedCharacter(code: Code): State | undefined {
      if (code === null || isLineEnding(code)) return inside(code);
      effects.consume(code);
      return inside;
    }

    function closeHere(code: Code): State | undefined {
      // Nothing between the delimiters is not math.
      if (!seen) return nok(code);
      exitData();
      effects.enter("texMathSequence");
      effects.consume(code);
      return closingCharacter;
    }

    function closingCharacter(code: Code): State | undefined {
      effects.consume(code);
      effects.exit("texMathSequence");
      effects.exit(type);
      return ok;
    }

    function enterData(): void {
      if (inData) return;
      effects.enter("texMathData");
      inData = true;
      seen = true;
    }

    function exitData(): void {
      if (!inData) return;
      effects.exit("texMathData");
      inData = false;
    }
  }

  function tokenizeEnd(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
    return (code) => {
      effects.enter("texMathSequence");
      effects.consume(code);
      return (next) => {
        if (next !== closing) return nok(next);
        effects.consume(next);
        effects.exit("texMathSequence");
        return ok;
      };
    };
  }
}

/** micromark's codes for line endings (CR, LF, CRLF) are the numbers below -2. */
function isLineEnding(code: Code): boolean {
  return code !== null && code < -2;
}

const fromMarkdown: FromMarkdownExtension = {
  enter: { texMathInline: enter, texMathDisplay: enter },
  exit: { texMathInline: exit, texMathDisplay: exit, texMathData: exitData },
};

function enter(this: CompileContext, token: Token): undefined {
  const node: InlineMath = { type: "inlineMath", value: "" };
  this.enter(node, token);
  this.buffer();
}

/**
 * In HTML, math is `code.language-math`, which KaTeX renders, displayed when the code is in a `pre`, as remark-math
 * writes `$$` blocks. A class such as `math-display` would not do: sanitizing keeps only `language-*` classes on code.
 * KaTeX replaces the `pre`, so none ends up in the paragraph.
 */
function exit(this: CompileContext, token: Token): undefined {
  const value = this.resume();
  const node = this.stack.at(-1) as InlineMath;
  this.exit(token);
  node.value = value;
  const code: Element = {
    type: "element",
    tagName: "code",
    properties: { className: ["language-math"] },
    children: [{ type: "text", value }],
  };
  node.data =
    token.type === "texMathDisplay"
      ? { hName: "pre", hChildren: [code] }
      : { hName: "code", hProperties: code.properties, hChildren: code.children };
}

function exitData(this: CompileContext, token: Token): undefined {
  // The text inside, added as any text is.
  this.config.enter.data?.call(this, token);
  this.config.exit.data?.call(this, token);
}
