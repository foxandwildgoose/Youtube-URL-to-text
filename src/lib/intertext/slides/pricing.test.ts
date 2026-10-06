import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hypotheticalCost, PRICING, usageCost } from "./pricing.ts";
describe("slide USD accounting", () => {
  it("matches all three explicitly hypothetical examples", () => {
    const sol = PRICING["gpt-6.1-sol"],
      luna = PRICING["gpt-6-luna"];
    assert.equal(hypotheticalCost(96, 3000, 1000, sol), 1.536);
    assert.equal(hypotheticalCost(96, 3000, 1000, sol, 0.25), 1.92);
    assert.equal(
      hypotheticalCost(80, 3000, 1000, luna) + hypotheticalCost(16, 3000, 1000, sol),
      0.32,
    );
    assert.equal(
      (hypotheticalCost(80, 3000, 1000, luna) + hypotheticalCost(16, 3000, 1000, sol)) * 1.25,
      0.4,
    );
    assert.equal(hypotheticalCost(160, 7000, 1500, sol), 4.64);
    assert.equal(hypotheticalCost(160, 7000, 1500, sol, 0.25), 5.8);
  });
  it("does not double count reasoning output or grant fictional discounts", () => {
    assert.equal(
      usageCost(
        {
          inputTokens: 3000,
          outputTokens: 1000,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 800,
        },
        PRICING["gpt-6.1-sol"],
      ),
      0.016,
    );
  });
  it("accounts separately for reported cached inputs", () => {
    assert.equal(
      usageCost(
        {
          inputTokens: 2000,
          outputTokens: 1000,
          cachedInputTokens: 1000,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
        },
        PRICING["gpt-6.1-sol"],
      ),
      0.0121,
    );
  });
});
