import { describe, expect, test } from "bun:test";
import { defaultStyleHints, defaultUserModel, parseUserModelInput, parseUserModelJson, serializeUserModelJson } from "./userModel";

describe("userModel", () => {
  test("parseUserModelJson returns default when empty", () => {
    const parsed = parseUserModelJson("{}");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value).toEqual(defaultUserModel);
  });

  test("parseUserModelJson returns error on invalid JSON", () => {
    const parsed = parseUserModelJson("{");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error.type).toBe("INVALID_JSON");
  });

  test("parseUserModelInput normalizes and applies defaults", () => {
    const parsed = parseUserModelInput({
      intent: "  仕事のペースを整える  ",
      styleHints: {
        openingPhrases: ["  今日は静かに始める。  "],
        closingPhrases: [],
        maxParagraphs: 3,
      },
      preferences: {
        avoidCopyingFromFragments: false,
      },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value.intent).toBe("仕事のペースを整える");
    expect(parsed.value.styleHints.openingPhrases[0]).toBe("今日は静かに始める。");
    // closing is empty -> default is applied
    expect(parsed.value.styleHints.closingPhrases).toEqual(defaultStyleHints.closingPhrases);
    expect(parsed.value.styleHints.maxParagraphs).toBe(3);
    expect(parsed.value.preferences.avoidCopyingFromFragments).toBe(false);
  });

  test("serializeUserModelJson roundtrips", () => {
    const json = serializeUserModelJson(defaultUserModel);
    const parsed = parseUserModelJson(json);
    expect(parsed.ok).toBe(true);
  });
});

