import { describe, it, expect } from "vitest";
import {
  FOLLOWUP_TEMPLATES,
  firstNameFrom,
  personalise,
  FOLLOWUP_NAME_PLACEHOLDER,
} from "./followup-templates";

describe("follow-up templates", () => {
  it("exposes the five approved starting templates", () => {
    expect(FOLLOWUP_TEMPLATES.map((t) => t.key)).toEqual([
      "thanks",
      "next_steps",
      "proposal",
      "information",
      "custom",
    ]);
  });

  it("wording stays generic — never assumes the meeting type/subject", () => {
    const forbidden = /\b(client|prospect|supplier|website|project|campaign|invoice)\b/i;
    for (const t of FOLLOWUP_TEMPLATES) {
      expect(forbidden.test(t.subject)).toBe(false);
      expect(forbidden.test(t.body)).toBe(false);
    }
  });

  it("custom template starts empty (fully editable)", () => {
    const custom = FOLLOWUP_TEMPLATES.find((t) => t.key === "custom")!;
    expect(custom.subject).toBe("");
    expect(custom.body).toBe("");
  });

  it("firstNameFrom takes the first token, else 'there'", () => {
    expect(firstNameFrom("Ann Smith")).toBe("Ann");
    expect(firstNameFrom("  Bob ")).toBe("Bob");
    expect(firstNameFrom(null)).toBe("there");
    expect(firstNameFrom("")).toBe("there");
  });

  it("personalise substitutes every [First name] occurrence", () => {
    const t = `Hi ${FOLLOWUP_NAME_PLACEHOLDER}, thanks ${FOLLOWUP_NAME_PLACEHOLDER}.`;
    expect(personalise(t, "Ann Smith")).toBe("Hi Ann, thanks Ann.");
    expect(personalise(t, null)).toBe("Hi there, thanks there.");
  });
});
