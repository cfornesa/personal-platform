import { describe, expect, it } from "vitest";
import {
  computeExhibitBottomVisibleY,
  computeExhibitGridCenterY,
} from "@/lib/immersive-gallery";

describe("exhibit wall layout", () => {
  it("keeps the bottom visible edge above the floor for single-row exhibits", () => {
    expect(computeExhibitBottomVisibleY(1)).toBeGreaterThan(0);
  });

  it("raises multi-row exhibits so the lower row still clears the floor", () => {
    expect(computeExhibitGridCenterY(2)).toBeGreaterThan(computeExhibitGridCenterY(1));
    expect(computeExhibitBottomVisibleY(2)).toBeGreaterThan(0);
  });
});
