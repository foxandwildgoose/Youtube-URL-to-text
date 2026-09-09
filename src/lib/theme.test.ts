import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseThemeMode, resolveTheme, themeColor } from "./theme.ts";

describe("theme", () => {
  it("defaults unknown storage values to system", () => {
    assert.equal(parseThemeMode(null), "system");
    assert.equal(parseThemeMode("sepia"), "system");
    assert.equal(parseThemeMode("dark"), "dark");
  });

  it("follows the OS only in system mode", () => {
    assert.equal(resolveTheme("system", true), "dark");
    assert.equal(resolveTheme("system", false), "light");
    assert.equal(resolveTheme("light", true), "light");
    assert.equal(resolveTheme("dark", false), "dark");
  });

  it("uses paper and charcoal theme-color values", () => {
    assert.equal(themeColor("light"), "#F6F3EE");
    assert.equal(themeColor("dark"), "#14110E");
  });
});
