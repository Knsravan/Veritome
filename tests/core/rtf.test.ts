import assert from "node:assert/strict";
import { test } from "node:test";
import { rtfToText } from "../../src/core/text/rtf.ts";

test("RTF becomes paragraphs of plain text with accents and Unicode kept", () => {
  const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Times New Roman;}}{\colortbl;\red0\green0\blue0;}
{\*\generator Word;}\f0\fs20 Soil respiration in caf\'e9 plots\par
The gain Q\u956?\u957? was high \endash{} as expected.\par
{\pict\pngblip 89504e47}Next \{braces\} line\line two}`;
  assert.equal(rtfToText(rtf), "Soil respiration in café plots\n\nThe gain Qμν was high – as expected.\n\nNext {braces} line\ntwo");
});
