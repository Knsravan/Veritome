import { describe, expect, it } from "vitest";
import { compareHashes, dhashFromGray, hamming, type ImageHash } from "@/lib/images/hash";

describe("image hashes", () => {
  it("dHash compares neighbouring brightness on a 9x8 grid", () => {
    const rising = Array.from({ length: 72 }, (_, i) => i % 9); // brighter to the right: every comparison is "not greater"
    expect(dhashFromGray(rising)).toBe("0000000000000000");
    const falling = Array.from({ length: 72 }, (_, i) => 9 - (i % 9));
    expect(dhashFromGray(falling)).toBe("ffffffffffffffff");
  });

  it("counts differing bits", () => {
    expect(hamming("0000000000000000", "0000000000000000")).toBe(0);
    expect(hamming("000000000000000f", "0000000000000000")).toBe(4);
    expect(hamming("ffffffffffffffff", "0000000000000000")).toBe(64);
  });

  it("finds the closest transform of the other image", () => {
    const a: ImageHash = { hash: "0f0f0f0f0f0f0f0f", variants: [], width: 100, height: 100, trivial: false };
    const b: ImageHash = {
      hash: "f0f0f0f0f0f0f0f0",
      variants: [
        { transform: "flipped", hash: "0f0f0f0f0f0f0f0e" },
        { transform: "rotated 90°", hash: "ffff0000ffff0000" },
      ],
      width: 100,
      height: 100,
      trivial: false,
    };
    expect(compareHashes(a, b)).toEqual({ distance: 1, transform: "flipped" });
  });
});
