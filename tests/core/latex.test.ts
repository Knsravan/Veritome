import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanPdfText, latexToText } from "../../src/core/text/latex.ts";

test("latexToText keeps prose, maths and citations, drops preamble and layout", () => {
  const src = String.raw`\documentclass{article}
\usepackage{amsmath}
\begin{document}
\title{Alder stands}
\maketitle
\begin{abstract}
We study \emph{soil} respiration.% hidden comment
\end{abstract}
\section{Introduction}
Respiration rose by 5\% \cite{smith2020} as shown in Fig.~\ref{fig:a}.
\begin{equation}
R = R_0 e^{kT}
\end{equation}
\begin{figure}[h]\includegraphics{x.png}\caption{Seasonal \textbf{flux}.}\end{figure}
\begin{thebibliography}{9}
\bibitem{smith2020} Smith, J. (2020). Fluxes. Ecology.
\end{thebibliography}
\end{document}`;
  const out = latexToText(src);
  assert.ok(!out.includes("usepackage"));
  assert.ok(!out.includes("hidden comment"));
  assert.match(out, /^Alder stands\n\nAbstract\n\nWe study soil respiration\.\n\nIntroduction\n\n/);
  assert.match(out, /rose by 5% \\cite\{smith2020\} as shown in Fig\. \\ref\{fig:a\}\./);
  assert.match(out, /\$\$R = R_0 e\^\{kT\}\$\$/);
  assert.match(out, /Seasonal flux\./);
  assert.match(out, /References\n\n\[1\] Smith, J\. \(2020\)\. Fluxes\. Ecology\./);
});

test("cleanPdfText joins wrapped lines, fixes hyphenation and drops page numbers", () => {
  const raw = "Introduction\nThis is a long line of text that wraps in the\nmiddle of a sentence and con-\ntinues here.\nShort end.\nNext paragraph starts here and is long enough to look normal.\n12\nReferences\n[1] Smith.";
  const out = cleanPdfText(raw);
  assert.match(out, /^Introduction\n\nThis is a long line of text that wraps in the middle of a sentence and continues here\.\n\nShort end\./);
  assert.ok(!/\b12\b/.test(out));
  assert.match(out, /\n\nReferences\n\n\[1\] Smith\.$/);
});
