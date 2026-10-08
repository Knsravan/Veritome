export interface ToolInfo {
  href: string;
  name: string;
  /** One line on what it does. */
  does: string;
  /** One line on what it cannot do. Shown wherever the tool is listed. */
  cannot: string;
  /** Not open yet: the page shows a "coming soon" message. */
  soon?: boolean;
}

export const TOOLS: readonly ToolInfo[] = [
  {
    href: "/plagiarism",
    name: "Plagiarism",
    does: "Finds copied and reworded passages in open-access papers, abstracts, Wikipedia and your own documents.",
    cannot:
      "Cannot see paywalled full texts or student-paper databases; heavy rewriting can slip through.",
  },
  {
    href: "/detector",
    name: "AI detector",
    does: "Trained models mark the paragraphs that read as AI-written or AI-polished, on pasted text or on your file in its own layout.",
    cannot:
      "Cannot prove who wrote a text. Light AI polishing often passes, and about 1 in 100 human paragraphs is flagged.",
  },
  {
    href: "/compare",
    soon: true,
    name: "Compare papers",
    does: "For teachers: add a class's papers and see which share text with each other, and where. Runs in your browser.",
    cannot:
      "Finds passages shared word for word (with small edits); reworded or translated sharing between papers is not found.",
  },
  {
    href: "/humaniser",
    soon: true,
    name: "Humaniser",
    does: "Revises stiff, formulaic prose while keeping citations, maths and numbers locked.",
    cannot:
      "Does not make text human-written. Disclose AI assistance where your publisher asks.",
  },
  {
    href: "/paraphraser",
    soon: true,
    name: "Paraphraser",
    does: "Rewrites passages in academic, simple, concise or expanded form with the same protections.",
    cannot:
      "Can shift meaning in ways a number check cannot catch. Read every rewrite.",
  },
  {
    href: "/citations",
    soon: true,
    name: "Citations",
    does: "Checks references against Crossref and others, flags retractions, and finds papers for uncited claims.",
    cannot:
      "“Not found” is not “fabricated”: books and reports are often missing from these databases.",
  },
  {
    href: "/grammar",
    soon: true,
    name: "Grammar",
    does: "Academic-style rules, common misspellings and readability, plus LanguageTool when connected.",
    cannot:
      "The built-in rules are not a full grammar parser, and readability scores are rough guides.",
  },
];
