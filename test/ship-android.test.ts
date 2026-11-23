import { describe, expect, it } from "vitest";
import { ANDROID_PACKAGE_RE, androidPackageFor } from "../src/lib/ship.js";

describe("Android package id for easykit ship", () => {
  it("derives a valid application id from any project name", () => {
    expect(androidPackageFor("ItDemo")).toBe("app.easysuite.itdemo");
    expect(androidPackageFor("Thai Village Delivery")).toBe("app.easysuite.thai_village_delivery");
    expect(androidPackageFor("2048 Rush")).toBe("app.easysuite.g2048_rush");
    expect(androidPackageFor("ร้านข้าวมันไก่")).toBe("app.easysuite.game");
    for (const n of ["ItDemo", "Thai Village Delivery", "2048 Rush", "ร้านข้าวมันไก่", "--"]) expect(androidPackageFor(n)).toMatch(ANDROID_PACKAGE_RE);
  });
  it("rejects ids Android would refuse", () => {
    for (const bad of ["game", "app.1game", "app..x", "app.my-game", ".app.x"]) expect(ANDROID_PACKAGE_RE.test(bad), bad).toBe(false);
    expect(ANDROID_PACKAGE_RE.test("app.studio.my_game2")).toBe(true);
  });
});
