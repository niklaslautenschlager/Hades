import { describe, it, expect } from "vitest";
import { minimalEdit, externalEdit } from "./editorSync";

function apply(text: string, e: { from: number; to: number; insert: string }): string {
  return text.slice(0, e.from) + e.insert + text.slice(e.to);
}

describe("minimalEdit", () => {
  it("returns null for equal text", () => {
    expect(minimalEdit("same", "same")).toBeNull();
    expect(minimalEdit("", "")).toBeNull();
  });

  it("replaces only the changed middle", () => {
    expect(minimalEdit("hello brave world", "hello kind world")).toEqual({ from: 6, to: 11, insert: "kind" });
  });

  it("handles pure insertion, deletion, and empty sides", () => {
    expect(minimalEdit("ab", "aXb")).toEqual({ from: 1, to: 1, insert: "X" });
    expect(minimalEdit("aXb", "ab")).toEqual({ from: 1, to: 2, insert: "" });
    expect(minimalEdit("", "text")).toEqual({ from: 0, to: 0, insert: "text" });
    expect(minimalEdit("text", "")).toEqual({ from: 0, to: 4, insert: "" });
  });

  it("keeps edits on the cursor-relevant side for repeated characters", () => {
    const e = minimalEdit("aaaa", "aaaaa")!;
    expect(apply("aaaa", e)).toBe("aaaaa");
  });

  it("never splits a surrogate pair", () => {
    const cur = "a😀b";
    const next = "a😁b";
    const e = minimalEdit(cur, next)!;
    expect(apply(cur, e)).toBe(next);
    const unit = (i: number) => cur.charCodeAt(i);
    const cutsPair = (i: number) => i > 0 && i < cur.length && unit(i - 1) >= 0xd800 && unit(i - 1) <= 0xdbff && unit(i) >= 0xdc00 && unit(i) <= 0xdfff;
    expect(cutsPair(e.from)).toBe(false);
    expect(cutsPair(e.to)).toBe(false);
  });

  it("round-trips random strings, including emoji", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const alphabet = ["a", "b", "c", " ", "\n", "😀", "😁", "é", "界"];
    const gen = () => Array.from({ length: Math.floor(rnd() * 12) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join("");
    for (let i = 0; i < 400; i++) {
      const a = gen();
      const b = gen();
      const e = minimalEdit(a, b);
      expect(e === null ? a : apply(a, e)).toBe(b);
    }
  });
});

describe("externalEdit", () => {
  it("ignores our own echo even when the buffer has already moved on", () => {
    expect(externalEdit("typed more", "typed", "typed")).toBeNull();
  });

  it("returns an edit when the store changed from outside (a sync pull)", () => {
    const e = externalEdit("old text", "new text from device B", "old text")!;
    expect(apply("old text", e)).toBe("new text from device B");
  });

  it("returns null when the buffer already shows the new content", () => {
    expect(externalEdit("pulled", "pulled", "stale")).toBeNull();
  });
});
