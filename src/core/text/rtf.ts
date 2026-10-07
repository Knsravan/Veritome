/**
 * Plain text from a Rich Text Format (.rtf) file: paragraphs, line breaks, tabs and accented or Unicode
 * characters are kept; fonts, colours, pictures and other destinations are dropped.
 */
export function rtfToText(rtf: string): string {
  if (!rtf.startsWith("{\\rtf")) throw new Error("This does not look like an RTF file.");
  let out = "";
  const stack: Array<{ skip: boolean; uc: number }> = [];
  let skip = false;
  let uc = 1;
  let pendingSkip = 0;
  const SKIP = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "headerl", "headerr", "footerl", "footerr", "object", "listtable", "listoverridetable", "rsidtbl", "generator", "themedata", "colorschememapping", "latentstyles", "datastore", "xmlnstbl", "mmathPr", "fldinst"]);
  let i = 0;
  while (i < rtf.length) {
    const c = rtf[i]!;
    if (c === "{") {
      stack.push({ skip, uc });
      i++;
      continue;
    }
    if (c === "}") {
      const top = stack.pop();
      if (top) ({ skip, uc } = top);
      i++;
      continue;
    }
    if (c === "\\") {
      const next = rtf[i + 1] ?? "";
      if (next === "*") {
        skip = true;
        i += 2;
        continue;
      }
      if (next === "'") {
        const code = parseInt(rtf.slice(i + 2, i + 4), 16);
        if (pendingSkip > 0) pendingSkip--;
        else if (!skip && Number.isFinite(code)) out += String.fromCharCode(code);
        i += 4;
        continue;
      }
      if (/[\\{}]/.test(next)) {
        if (!skip) out += next;
        i += 2;
        continue;
      }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i, i + 40));
      if (!m) {
        i += 2;
        continue;
      }
      const [all, word, arg] = m;
      i += all.length;
      if (SKIP.has(word!)) skip = true;
      else if (skip) continue;
      else if (word === "par" || word === "sect") out += "\n\n";
      else if (word === "line") out += "\n";
      else if (word === "tab" || word === "cell") out += "\t";
      else if (word === "row") out += "\n";
      else if (word === "uc") uc = Number(arg ?? "1");
      else if (word === "u") {
        let code = Number(arg ?? "0");
        if (code < 0) code += 65536;
        out += String.fromCharCode(code);
        pendingSkip = uc;
      } else if (word === "emdash") out += "—";
      else if (word === "endash") out += "–";
      else if (word === "lquote") out += "‘";
      else if (word === "rquote") out += "’";
      else if (word === "ldblquote") out += "“";
      else if (word === "rdblquote") out += "”";
      else if (word === "bullet") out += "•";
      continue;
    }
    if (c === "\r" || c === "\n") {
      i++;
      continue;
    }
    if (pendingSkip > 0) pendingSkip--;
    else if (!skip) out += c;
    i++;
  }
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
