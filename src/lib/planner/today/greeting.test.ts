import { describe, it, expect } from "vitest";
import { salutationFor, isEvening, firstNameOf, workloadSentence, buildGreeting } from "./greeting";

// Africa/Johannesburg is UTC+2 (no DST): UTC hour + 2 = agency hour.
const at = (utcHour: number) => new Date(Date.UTC(2026, 7, 4, utcHour, 0, 0));

describe("greeting time-of-day (agency tz)", () => {
  it("morning / afternoon / evening by agency hour", () => {
    expect(salutationFor(at(7))).toBe("Good morning"); // 09:00 SAST
    expect(salutationFor(at(11))).toBe("Good afternoon"); // 13:00
    expect(salutationFor(at(15))).toBe("Good evening"); // 17:00
    expect(salutationFor(at(20))).toBe("Good evening"); // 22:00
  });
  it("evening mode flips on at ~17:00 agency time", () => {
    expect(isEvening(at(14))).toBe(false); // 16:00
    expect(isEvening(at(15))).toBe(true); // 17:00
  });
});

describe("firstNameOf", () => {
  it("takes the first token; blank/null → null", () => {
    expect(firstNameOf("Eloff van der Merwe")).toBe("Eloff");
    expect(firstNameOf("  ")).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });
});

describe("workloadSentence", () => {
  it("pluralises honestly and drops the overdue clause when zero", () => {
    expect(workloadSentence({ tasks: 5, meetings: 2, overdue: 1 })).toBe("You have 5 tasks and 2 meetings, with 1 overdue item, today.");
    expect(workloadSentence({ tasks: 1, meetings: 1, overdue: 0 })).toBe("You have 1 task and 1 meeting today.");
    expect(workloadSentence({ tasks: 3, meetings: 0, overdue: 2 })).toBe("You have 3 tasks and 0 meetings, with 2 overdue items, today.");
  });
  it("all-zero → caught up", () => {
    expect(workloadSentence({ tasks: 0, meetings: 0, overdue: 0 })).toBe("You're all caught up for today.");
  });
});

describe("buildGreeting", () => {
  it("assembles salutation + first name + date + workload + evening flag", () => {
    const g = buildGreeting(at(7), "Ashwin Pillay", { tasks: 2, meetings: 1, overdue: 0 });
    expect(g.salutation).toBe("Good morning");
    expect(g.firstName).toBe("Ashwin");
    expect(g.evening).toBe(false);
    expect(g.workload).toContain("2 tasks and 1 meeting");
    expect(g.dateLabel).toMatch(/August/);
  });
});
