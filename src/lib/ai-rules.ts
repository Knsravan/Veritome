/**
 * What publishers and research-ethics bodies allow authors to do with AI writing tools, in plain words, from their
 * own policy pages. Checked on the date below; policies change, so the page always sends readers to the source.
 */

export const AI_RULES_CHECKED = "9 October 2026";

export interface PublisherRule {
  name: string;
  author: string;
  editing: string;
  disclose: string;
  images: string;
  url: string;
  updated?: string;
}

export const PUBLISHER_RULES: readonly PublisherRule[] = [
  {
    name: "Elsevier",
    author: "No.",
    editing: "Allowed with human oversight: drafting help, translation, better language and readability.",
    disclose:
      "A separate statement at the end of the paper, before the references. Basic grammar and spelling checks need none; changes to sentence structure do.",
    images: "Diagrams allowed if disclosed in the caption. No AI-made or AI-altered research images (microscopy, blots, scans).",
    url: "https://www.elsevier.com/about/policies-and-standards/generative-ai-policies-for-journals",
    updated: "June 2026",
  },
  {
    name: "Springer Nature (and Nature)",
    author: "No.",
    editing:
      "Grammar, language and translation are fine. Drafting from your own input and heavy editing are allowed with care. AI writing results or claims on its own is not allowed.",
    disclose: "An AI declaration in the manuscript, describing the use.",
    images: "Only from verifiable data or your own material, disclosed in the caption. No images made from prompts alone, no photorealistic fakes.",
    url: "https://www.springernature.com/gp/policies/editorial-policies/ai-manuscript-preparation",
  },
  {
    name: "IEEE",
    author: "Not stated outright on the pages checked.",
    editing: "Improving the language of your own text is allowed without acknowledgment, if it adds nothing and changes no meaning.",
    disclose: "Any AI-generated text, figures, images or code: in the Acknowledgments, naming the tool, the sections and how it was used.",
    images: "Covered by the same Acknowledgments rule; AI-generated data must be labelled.",
    url: "https://journals.ieeeauthorcenter.ieee.org/become-an-ieee-journal-author/publishing-ethics/guidelines-and-policies/submission-and-peer-review-policies/",
    updated: "Operations manual amended 25 June 2026",
  },
  {
    name: "Wiley",
    author: "No.",
    editing: "Allowed as a support tool. Grammar fixes and word-choice suggestions need no disclosure.",
    disclose: "Drafting, substantial editing or translation: in the Acknowledgments. AI used in the research: in Methods.",
    images: "Charts and illustrations allowed with disclosure in the caption. No AI-edited photographs.",
    url: "https://authorservices.wiley.com/ethics-guidelines/index.html",
    updated: "July 2026",
  },
  {
    name: "Taylor & Francis",
    author: "No.",
    editing: "Welcomed for copyediting, language and non-native-language support. Some journals allow language help only.",
    disclose: "Any generative AI use: name the tool and version, how and why it was used.",
    images: "Charts and concept illustrations allowed. No AI-made or altered research or clinical images.",
    url: "https://taylorandfrancis.com/our-policies/ai-policy/",
  },
  {
    name: "SAGE",
    author: "Follows COPE (no AI authors).",
    editing: "Language, grammar and structure help is allowed and needs no disclosure.",
    disclose: "AI-produced text, references or images that affect methods, results or conclusions: in Methods or Acknowledgements.",
    images: "Illustrations and infographics allowed with disclosure; not as research images.",
    url: "https://www.sagepub.com/journals/publication-ethics-policies/artificial-intelligence-policy",
  },
  {
    name: "ACM",
    author: "No, under any conditions.",
    editing: "Allowed, if the work is not mainly the tool's output and nothing is plagiarised or falsified.",
    disclose: "Writing help no longer needs disclosure. AI used to do the research (data, code, analysis, AI-made figures): in detail in Methods.",
    images: "AI-made figures fall under the Methods rule.",
    url: "https://www.acm.org/publications/policies/new-acm-policy-on-authorship",
    updated: "14 May 2026",
  },
  {
    name: "PLOS",
    author: "No.",
    editing: "Spelling, grammar and rephrasing for clarity need no disclosure.",
    disclose: "Other content generated or revised by AI: in Methods, the Acknowledgements or figure legends, with the tool and how its output was checked.",
    images: "Illustrations allowed, disclosed in the legend; must not misrepresent research results.",
    url: "https://journals.plos.org/plosone/s/ethical-publishing-practice",
  },
  {
    name: "MDPI",
    author: "No.",
    editing: "Grammar, structure, spelling and formatting need no declaration.",
    disclose: "AI-generated text, data or graphics: declared at submission, described in Methods, tool and version in Acknowledgments.",
    images: "AI graphics fall under the same disclosure rule.",
    url: "https://www.mdpi.com/ethics",
  },
  {
    name: "Science (AAAS)",
    author: "No.",
    editing: "Allowed, but even help with writing or presentation must be disclosed.",
    disclose: "In the cover letter and in Methods or Acknowledgments.",
    images: "Not allowed without the editors' explicit permission.",
    url: "https://www.science.org/content/page/science-journals-editorial-policies",
  },
];

export const ETHICS_RULES: readonly PublisherRule[] = [
  {
    name: "ICMJE (medical journals)",
    author: "No: a chatbot cannot take responsibility for the work.",
    editing: "Allowed; authors must check the output for plagiarism and errors.",
    disclose: "In the cover letter and the paper: writing help in the Acknowledgment, AI used for data or figures in Methods. Not disclosing may count as misconduct.",
    images: "Covered by the same disclosure rules.",
    url: "https://www.icmje.org/recommendations/browse/artificial-intelligence/ai-use-by-authors.html",
    updated: "January 2026",
  },
  {
    name: "COPE (publication ethics)",
    author: "No: AI cannot take responsibility, declare conflicts or hold copyright.",
    editing: "Not banned, but must be disclosed.",
    disclose: "In Materials and Methods or a similar section, naming the tool.",
    images: "Covered by the same disclosure rule.",
    url: "https://publicationethics.org/guidance/cope-position/authorship-and-ai-tools",
  },
  {
    name: "APA (journals and style)",
    author: "No.",
    editing: "Allowed, but APA journals ask you to disclose it, even for editing.",
    disclose: "Extensive editing or translation: in the author note. In APA style, describe the use and the prompt, and cite the tool's maker as author.",
    images: "Disclose with the prompts where the figure appears.",
    url: "https://www.apa.org/pubs/journals/resources/publishing-tips/policy-generative-ai",
  },
];

export const TURNITIN_FACTS = {
  url: "https://guides.turnitin.com/hc/en-us/articles/28477544839821-Turnitin-s-AI-writing-detection-capabilities-FAQ",
  points: [
    "Scores from 1% to 19% are not shown as a number, only as an asterisk (*%), because low scores are unreliable.",
    "Turnitin says the score should not be the only basis for any action, and that it does not decide misconduct: the instructor does.",
    "It reports under 1% false positives for documents above 20%, and says formulaic or repetitive writing is more often flagged wrongly.",
    "It needs at least 300 words of prose; lists, bullet points and code are left out.",
  ],
};

export const UNIVERSITIES = {
  summary:
    "There is no universal percentage. Each university sets its own rules, and most treat a detector score as a reason to look closer, not as proof. Several have switched AI detection off because of false alarms:",
  examples: [
    { name: "Vanderbilt University (2023)", url: "https://www.vanderbilt.edu/brightspace/2023/08/16/guidance-on-ai-detection-and-why-were-disabling-turnitins-ai-detector/" },
    { name: "Curtin University (2026)", url: "https://www.curtin.edu.au/news/oasis-news/update-on-turnitin-ai-detection-tool/" },
    {
      name: "Washington State University (2026)",
      url: "https://provost.wsu.edu/documents/2026/02/cancellation-of-turnitin-ai-detection-software_memo-to-instructors_provost-office_spring-2026.pdf",
    },
    { name: "University of the Free State (2026)", url: "https://www.ufs.ac.za/templates/news-archive/campus-news/2026/may/ufs-shifts-academic-integrity-approach-in-ai-era" },
  ],
};
