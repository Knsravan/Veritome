import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeEntities, htmlToText } from "../../src/core/plagiarism/webpage.ts";

test("htmlToText keeps the readable text and drops scripts, styles and navigation", () => {
  const html = `<html><head><title>T</title><style>p{color:red}</style></head><body>
    <nav><a href="/">Home</a> | <a href="/about">About</a></nav>
    <article><h1>Sign language</h1><p>Indian Sign Language is an important means of <b>communication</b> for people.</p>
    <script>var x = "<p>not text</p>";</script><p>Second&nbsp;paragraph &amp; more &#8211; done.</p></article>
    <footer>© 2025 Site</footer></body></html>`;
  const t = htmlToText(html);
  assert.equal(t, "Sign language\nIndian Sign Language is an important means of communication for people.\nSecond paragraph & more – done.");
});

test("decodeEntities handles named, decimal and hex entities", () => {
  assert.equal(decodeEntities("a&lt;b &#x3B1; &#946; &unknown;"), "a<b α β &unknown;");
});
