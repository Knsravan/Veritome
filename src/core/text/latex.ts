/**
 * Turns a LaTeX source into plain text the checkers can read. Maths and
 * citation commands are kept so the protection step can lock them; layout
 * commands are dropped and section titles become paragraphs.
 */
export function latexToText(source: string): string {
  let s = source.replace(/\r\n?/g, "\n");
  const begin = s.indexOf("\\begin{document}");
  if (begin >= 0) s = s.slice(begin + "\\begin{document}".length);
  const end = s.indexOf("\\end{document}");
  if (end >= 0) s = s.slice(0, end);

  // Comments: an unescaped % to the end of the line.
  s = s.replace(/(^|[^\\])%.*$/gm, "$1");
  s = s.replace(/\\begin\{comment\}[\s\S]*?\\end\{comment\}/g, "");

  // Floats: keep only the caption.
  s = s.replace(/\\begin\{(figure|table)\*?\}[\s\S]*?\\end\{\1\*?\}/g, (block) => {
    const cap = /\\caption(?:\[[^\]]*\])?\{((?:[^{}]|\{[^{}]*\})*)\}/.exec(block);
    return cap?.[1] ? `\n\n${cap[1]}\n\n` : "\n\n";
  });
  // Display maths becomes $$...$$ so it is protected later.
  s = s.replace(/\\begin\{(equation|align|gather|multline|eqnarray|displaymath)\*?\}([\s\S]*?)\\end\{\1\*?\}/g, (_m, _env: string, body: string) => `$$${body.trim()}$$`);

  // Bibliography.
  s = s.replace(/\\begin\{thebibliography\}\{[^}]*\}/g, "\n\nReferences\n\n");
  s = s.replace(/\\end\{thebibliography\}/g, "");
  let item = 0;
  s = s.replace(/\\bibitem(?:\[[^\]]*\])?\{[^}]*\}\s*/g, () => `\n\n[${++item}] `);
  s = s.replace(/\\bibliography\{[^}]*\}|\\bibliographystyle\{[^}]*\}|\\printbibliography(?:\[[^\]]*\])?/g, "");

  // Headings and the abstract.
  s = s.replace(/\\(?:part|chapter|section|subsection|subsubsection|paragraph)\*?(?:\[[^\]]*\])?\{((?:[^{}]|\{[^{}]*\})*)\}/g, "\n\n$1\n\n");
  s = s.replace(/\\begin\{abstract\}/g, "\n\nAbstract\n\n").replace(/\\end\{abstract\}/g, "\n\n");
  s = s.replace(/\\(?:title|author)\{((?:[^{}]|\{[^{}]*\})*)\}/g, "\n\n$1\n\n");
  s = s.replace(/\\item(?:\[[^\]]*\])?\s*/g, "\n\n");
  s = s.replace(/\\(?:begin|end)\{[a-zA-Z*]+\}(?:\{[^}]*\}|\[[^\]]*\])*/g, "\n\n");

  // Formatting commands keep their argument.
  for (let i = 0; i < 3; i++) {
    s = s.replace(/\\(?:textbf|textit|emph|underline|texttt|textsc|textrm|textsf|mbox|text|uline)\{((?:[^{}]|\{[^{}]*\})*)\}/g, "$1");
  }
  s = s.replace(/\\footnote\{((?:[^{}]|\{[^{}]*\})*)\}/g, " ($1)");
  s = s.replace(/\\url\{([^}]*)\}/g, "$1");
  s = s.replace(/\\href\{([^}]*)\}\{([^}]*)\}/g, "$2 ($1)");
  // Remove remaining layout-only commands, but keep cite/ref commands (protected later) and inline maths.
  s = s.replace(/\\(?:maketitle|tableofcontents|newpage|clearpage|centering|noindent|small|large|Large|footnotesize|vspace\*?\{[^}]*\}|hspace\*?\{[^}]*\}|label\{[^}]*\}|keywords)/g, "");

  s = s
    .replace(/``/g, "“")
    .replace(/''/g, "”")
    .replace(/(^|[^\\])~/g, "$1 ")
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/\\\\/g, "\n")
    .replace(/\\([%&$#_{}])/g, "$1");

  return s
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").replace(/[ \t]{2,}/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Cleans text pulled out of a PDF: removes page numbers, re-joins hyphenated
 * words and lines broken by the layout, and keeps real paragraph breaks.
 */
const HEADING = /^(?:\d+(?:\.\d+)*\.?\s+)?(?:references|bibliography|abstract|introduction|background|methods?|materials and methods|results|discussion|conclusions?|acknowledg(?:e)?ments)$/i;

export function cleanPdfText(raw: string): string {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .replace(/­/g, "")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim());
  const content = lines.filter((l) => l && !/^(?:page\s+)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i.test(l));
  const avg = content.length ? content.reduce((n, l) => n + l.length, 0) / content.length : 0;

  let out = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (!line) {
      if (out && !out.endsWith("\n\n")) out += "\n\n";
      continue;
    }
    if (/^(?:page\s+)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i.test(line)) continue;
    if (!out || out.endsWith("\n\n")) {
      out += line;
      continue;
    }
    const prev = out.slice(out.lastIndexOf("\n") + 1);
    const prevLine = lines.slice(0, i).reverse().find((l) => l) ?? "";
    if (/[a-z]-$/.test(prev) && /^[a-z]/.test(line)) {
      out = out.slice(0, -1) + line;
    } else if (/[.!?:]["”)]?$/.test(prevLine) && prevLine.length < avg * 0.7 && /^[A-Z0-9[“"(]/.test(line)) {
      out += `\n\n${line}`;
    } else if (HEADING.test(line) || HEADING.test(prevLine)) {
      out += `\n\n${line}`;
    } else {
      out += ` ${line}`;
    }
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}
