import { describe, it, expect } from "vitest";
import { rankGroups, fitCount } from "../../src/components/HomeActivity/rankGroups";

describe("rankGroups (Home activity Groups tab)", () => {
  it("does not let quiet joined groups hide a busy one", () => {
    const activity = { busy: { week: 22 } };
    const joined = new Set();
    for (let i = 0; i < 20; i++) { activity[`quiet${i}`] = { week: 0 }; joined.add(`quiet${i}`); }
    activity.mine = { week: 3 }; joined.add("mine");
    const out = rankGroups(activity, joined);
    expect(out).toHaveLength(16);
    expect(out.slice(0, 2)).toEqual(["mine", "busy"]);
  });

  it("puts active joined groups first, then busiest, then quiet joined, then quiet others", () => {
    const activity = { a: { week: 1 }, b: { week: 50 }, c: { week: 0 }, d: { week: 0 }, e: { week: 5 } };
    const joined = new Map([["a", "A"], ["c", "C"], ["e", "E"]]);
    expect(rankGroups(activity, joined)).toEqual(["e", "a", "b", "c", "d"]);
  });

  it("handles missing activity", () => {
    expect(rankGroups(undefined, new Set())).toEqual([]);
  });
});

describe("fitCount (Groups tab shows only whole rows)", () => {
  it("counts the rows whose bottom edge is inside the list", () => {
    expect(fitCount([80, 160, 240, 320], 250)).toBe(3);
    expect(fitCount([80, 160], 500)).toBe(2);
  });
  it("tolerates sub-pixel rounding at the edge", () => {
    expect(fitCount([100, 200.4], 200)).toBe(2);
  });
  it("always keeps at least one row", () => {
    expect(fitCount([400], 300)).toBe(1);
  });
});

describe("rankGroups limit", () => {
  it("returns up to 16 groups by default", () => {
    const activity = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`g${i}`, { week: i }]));
    expect(rankGroups(activity, new Set())).toHaveLength(16);
  });
});
