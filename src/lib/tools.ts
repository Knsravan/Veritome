export interface ToolInfo {
  href: string;
  name: string;
  /** One line on what it does. */
  does: string;
  /** One line on what it cannot do. Shown wherever the tool is listed. */
  cannot: string;
}

export const TOOLS: readonly ToolInfo[] = [
  {
    href: "/plagiarism",
    name: "Plagiarism",
    does: "Finds copied and reworded passages in open-access papers, abstracts, Wikipedia and your own documents.",
    cannot: "Cannot see paywalled full texts or student-paper databases; heavy rewriting can slip through.",
  },
  {
    href: "/detector",
    name: "AI patterns",
    does: "A trained model scores how closely the text resembles machine writing, section by section, with a range.",
    cannot: "Cannot prove who wrote a text. Misses about half of machine text; paraphrased text often passes.",
  },
  {
    href: "/humaniser",
    name: "Humaniser",
    does: "Revises stiff, formulaic prose while keeping citations, maths and numbers locked.",
    cannot: "Does not make text human-written. Disclose AI assistance where your publisher asks.",
  },
  {
    href: "/paraphraser",
    name: "Paraphraser",
    does: "Rewrites passages in academic, simple, concise or expanded form with the same protections.",
    cannot: "Can shift meaning in ways a number check cannot catch. Read every rewrite.",
  },
  {
    href: "/citations",
    name: "Citations",
    does: "Checks references against Crossref and others, flags retractions, and finds papers for uncited claims.",
    cannot: "“Not found” is not “fabricated”: books and reports are often missing from these databases.",
  },
  {
    href: "/grammar",
    name: "Grammar",
    does: "Academic-style rules, common misspellings and readability, plus LanguageTool when connected.",
    cannot: "The built-in rules are not a full grammar parser, and readability scores are rough guides.",
  },
];
