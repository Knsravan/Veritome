/**
 * Shows a Word file exactly as it is laid out (page size, margins, columns such as IEEE's two, fonts, headers,
 * tables, figures) using docx-preview, then draws findings onto it as underlines.
 *
 * Findings are offsets into the checked text, which was read from the same file by readDocx. The rendered page
 * text is matched to the checked text character by character (ignoring spacing, and skipping anything only one of
 * them has, such as list numbers), so each finding lands on the right words.
 */

export interface ExactMark {
  id: string;
  start: number;
  end: number;
  className: string;
  label: string;
  group?: number;
  n?: number;
}

export async function renderDocx(
  container: HTMLElement,
  data: Uint8Array,
): Promise<void> {
  const { renderAsync } = await import("docx-preview");
  container.innerHTML = "";
  await renderAsync(data.slice().buffer, container, container, {
    className: "docx",
    inWrapper: true,
    breakPages: true,
    ignoreLastRenderedPageBreak: false,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    renderComments: false,
    renderChanges: false,
    useBase64URL: true,
    experimental: true,
  });
}

interface Point {
  node: Text;
  offset: number;
}

/** Text nodes of the rendered pages in reading order, leaving out headers and footers (not in the checked text). */
function textNodes(container: HTMLElement): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const el = n.parentElement;
      if (!el || el.closest("header, footer, style, script"))
        return NodeFilter.FILTER_REJECT;
      return n.nodeValue && n.nodeValue.length
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

const norm = (c: string) => c.normalize("NFKC").toLowerCase();

/**
 * For each character of `text`, where it is on the rendered pages (or null for spacing and anything not shown).
 */
export function alignText(text: string, nodes: Text[]): Array<Point | null> {
  const page: Array<{ c: string; p: Point }> = [];
  for (const node of nodes) {
    const v = node.nodeValue ?? "";
    for (let i = 0; i < v.length; i++)
      if (!/\s/.test(v[i]!))
        page.push({ c: norm(v[i]!), p: { node, offset: i } });
  }
  const out: Array<Point | null> = new Array(text.length).fill(null);
  const chars: number[] = [];
  for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i]!)) chars.push(i);
  let j = 0;
  for (let k = 0; k < chars.length && j < page.length; k++) {
    const i = chars[k]!;
    const c = norm(text[i]!);
    if (page[j]!.c === c) {
      out[i] = page[j]!.p;
      j++;
      continue;
    }
    // Out of step: find the next 12 characters of the text a little further on the page (the page has extra
    // characters such as list numbers), or skip this character of the text (the page left it out).
    const probe = chars
      .slice(k, k + 12)
      .map((x) => norm(text[x]!))
      .join("");
    let found = -1;
    for (let d = 1; d <= 400 && j + d + probe.length <= page.length; d++) {
      let ok = true;
      for (let q = 0; q < probe.length; q++)
        if (page[j + d + q]!.c !== probe[q]) {
          ok = false;
          break;
        }
      if (ok) {
        found = j + d;
        break;
      }
    }
    if (found >= 0) {
      j = found;
      out[i] = page[j]!.p;
      j++;
    }
  }
  return out;
}

/** Removes marks drawn earlier, joining the text back together. */
export function clearMarks(container: HTMLElement) {
  for (const el of Array.from(container.querySelectorAll("[data-vt]")))
    el.replaceWith(...Array.from(el.childNodes));
  container.normalize();
}

/**
 * Draws findings as underlines. Overlapping findings nest: the first given is innermost and takes the click.
 * Each finding's first piece is focusable and has id "mark-{id}", so it can be scrolled to.
 */
export function drawMarks(
  container: HTMLElement,
  text: string,
  marks: readonly ExactMark[],
  interactive = true,
): void {
  clearMarks(container);
  if (!marks.length) return;
  const points = alignText(text, textNodes(container));
  // Pieces per text node: [from, to) within the node, with the marks covering them.
  const pieces = new Map<
    Text,
    Array<{ from: number; to: number; marks: ExactMark[] }>
  >();
  const order = new Map(marks.map((m, i) => [m, i]));
  const covering = (i: number) =>
    marks.filter((m) => m.start <= i && i < m.end);
  let current: {
    node: Text;
    from: number;
    to: number;
    marks: ExactMark[];
    key: string;
  } | null = null;
  const flush = () => {
    if (!current) return;
    if (!pieces.has(current.node)) pieces.set(current.node, []);
    pieces
      .get(current.node)!
      .push({ from: current.from, to: current.to, marks: current.marks });
    current = null;
  };
  const sorted = [...marks].sort((a, b) => a.start - b.start);
  const lo = sorted[0]?.start ?? 0;
  const hi = Math.max(...marks.map((m) => m.end));
  for (let i = Math.max(0, lo); i < Math.min(text.length, hi); i++) {
    const p = points[i];
    if (!p) continue;
    const ms = covering(i).sort((a, b) => order.get(a)! - order.get(b)!);
    const key = ms.map((m) => m.id).join("|");
    if (!ms.length) {
      flush();
      continue;
    }
    if (
      current &&
      current.node === p.node &&
      current.key === key &&
      current.to === p.offset
    )
      current.to = p.offset + 1;
    else if (
      current &&
      current.node === p.node &&
      current.key === key &&
      /^\s*$/.test((p.node.nodeValue ?? "").slice(current.to, p.offset))
    )
      current.to = p.offset + 1;
    else {
      flush();
      current = {
        node: p.node,
        from: p.offset,
        to: p.offset + 1,
        marks: ms,
        key,
      };
    }
  }
  flush();
  const placed = new Set<string>();
  for (const [node, list] of pieces) {
    // Work from the end of the node so earlier offsets stay valid.
    for (const piece of list.sort((a, b) => b.from - a.from)) {
      const after = node.splitText(piece.to);
      const middle = node.splitText(piece.from);
      void after;
      const [top, ...rest] = piece.marks;
      const inner = document.createElement("mark");
      inner.setAttribute("data-vt", "1");
      inner.dataset.mark = top!.id;
      inner.className = `mark ${top!.className}`;
      if (top!.group) inner.dataset.src = String(top!.group);
      let outer: HTMLElement = inner;
      for (const m of rest) {
        const span = document.createElement("span");
        span.setAttribute("data-vt", "1");
        span.dataset.mark = m.id;
        span.className = `mark mark-under ${m.className}`;
        if (m.group) span.dataset.src = String(m.group);
        span.appendChild(outer);
        outer = span;
      }
      middle.replaceWith(outer);
      inner.appendChild(middle);
    }
  }
  // Each numbered finding's badge sits on its first piece.
  for (const m of marks) {
    if (m.n === undefined) continue;
    const el = container.querySelector<HTMLElement>(
      `[data-mark="${CSS.escape(m.id)}"]`,
    );
    if (el) el.dataset.n = String(m.n);
  }
  if (!interactive) return;
  // Focusable first pieces, in reading order.
  for (const el of Array.from(
    container.querySelectorAll<HTMLElement>("mark[data-vt]"),
  )) {
    const id = el.dataset.mark!;
    if (placed.has(id)) continue;
    placed.add(id);
    const m = marks.find((x) => x.id === id)!;
    el.id = `mark-${id}`;
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute(
      "aria-label",
      `${m.label}: ${text.slice(m.start, m.end).replace(/\s+/g, " ").slice(0, 120)}`,
    );
  }
}
