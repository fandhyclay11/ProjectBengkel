import "dotenv/config";
import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkshopDateTime, workshopDateKey, workshopDateTimeInput } from "@/server/datetime";

test("workshop local datetime converts to computer timestamp and back", () => {
  process.env.APP_WORKSHOP_TIMEZONE = "Asia/Jakarta";
  const value = parseWorkshopDateTime("2026-09-30T10:15");
  assert.equal(value.toISOString(), "2026-09-30T03:15:00.000Z");
  assert.equal(workshopDateKey(value), "20260930");
  assert.equal(workshopDateTimeInput(value), "2026-09-30T10:15");
});

test("invalid calendar dates are rejected", () => {
  process.env.APP_WORKSHOP_TIMEZONE = "Asia/Jakarta";
  assert.throws(() => parseWorkshopDateTime("2026-02-31T10:15"));
  assert.throws(() => parseWorkshopDateTime("2026-09-30T25:00"));
});
