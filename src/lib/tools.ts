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
    does: "Finds word-for-word overlap with scholarly abstracts, optional web search and your own documents.",
    cannot: "Cannot see paywalled full texts or student-paper databases, and misses close paraphrase.",
  },
  {
    href: "/detector",
    name: "AI patterns",
    does: "Measures writing patterns common in language-model output, sentence by sentence, with an uncertainty range.",
    cannot: "Cannot prove who wrote a text. Careful and non-native human writing can score high.",
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
