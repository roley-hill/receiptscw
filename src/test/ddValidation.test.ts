// DD Vault — Step 1 Acceptance Gate
// 54 tests total (53 active + 1 skipped sentinel).
// This file WILL fail with module-not-found for @/lib/ddValidation until
// Step 4 creates that module. That failure is intentional and expected.

import { describe, it, expect } from "vitest";
import { APPFOLIO_COLUMNS } from "@/lib/ddValidation";

// ─────────────────────────────────────────────────────────────────────────────
// ORACLE — canonical 97-column AppFolio MFR Units export header contract
// (41 base + 10×5 recurring = 91 + 6 deposit = 97)
// ─────────────────────────────────────────────────────────────────────────────
const TEMPLATE_HEADERS: string[] = [
  // Base 41
  "Unit Name",
  "Unit Address 1",
  "Unit Address 2",
  "Unit City",
  "Unit State",
  "Unit Postal Code",
  "Unit Tags",
  "Market Rent",
  "Square Feet",
  "Bedrooms",
  "Bathrooms",
  "Cats Allowed",
  "Dogs Allowed",
  "Primary Tenant First Name",
  "Primary Tenant Last Name",
  "Primary Tenant Company Name",
  "Primary Tenant Move In",
  "Primary Tenant Move Out",
  "Lease From",
  "Lease To",
  "Unit Rent Charge",
  "Unit Rent Frequency",
  "Unit Rent Start Date",
  "Unit Rent End Date",
  "Primary Tenant Email Address",
  "Primary Tenant Phone Number 1",
  "Primary Tenant Phone Label 1",
  "Primary Tenant Phone Notes 1",
  "Tenant Tags",
  "Tenant Address 1",
  "Tenant Address 2",
  "Tenant City",
  "Tenant State",
  "Tenant Postal Code",
  "Roommate First 1",
  "Roommate Last 1",
  "Roommate Email 1",
  "Roommate 1 Phone 1",
  "Roommate 1 Phone Label 1",
  "Roommate Move In 1",
  "Roommate Move Out 1",
  // Recurring charges — 10 groups × 5 columns = 50
  "Charge 1 GL Account Code",
  "Charge 1 GL Account Label",
  "Charge 1 Charge Amount",
  "Charge 1 Charge Frequency",
  "Charge 1 Start Date",
  "Charge 2 GL Account Code",
  "Charge 2 GL Account Label",
  "Charge 2 Charge Amount",
  "Charge 2 Charge Frequency",
  "Charge 2 Start Date",
  "Charge 3 GL Account Code",
  "Charge 3 GL Account Label",
  "Charge 3 Charge Amount",
  "Charge 3 Charge Frequency",
  "Charge 3 Start Date",
  "Charge 4 GL Account Code",
  "Charge 4 GL Account Label",
  "Charge 4 Charge Amount",
  "Charge 4 Charge Frequency",
  "Charge 4 Start Date",
  "Charge 5 GL Account Code",
  "Charge 5 GL Account Label",
  "Charge 5 Charge Amount",
  "Charge 5 Charge Frequency",
  "Charge 5 Start Date",
  "Charge 6 GL Account Code",
  "Charge 6 GL Account Label",
  "Charge 6 Charge Amount",
  "Charge 6 Charge Frequency",
  "Charge 6 Start Date",
  "Charge 7 GL Account Code",
  "Charge 7 GL Account Label",
  "Charge 7 Charge Amount",
  "Charge 7 Charge Frequency",
  "Charge 7 Start Date",
  "Charge 8 GL Account Code",
  "Charge 8 GL Account Label",
  "Charge 8 Charge Amount",
  "Charge 8 Charge Frequency",
  "Charge 8 Start Date",
  "Charge 9 GL Account Code",
  "Charge 9 GL Account Label",
  "Charge 9 Charge Amount",
  "Charge 9 Charge Frequency",
  "Charge 9 Start Date",
  "Charge 10 GL Account Code",
  "Charge 10 GL Account Label",
  "Charge 10 Charge Amount",
  "Charge 10 Charge Frequency",
  "Charge 10 Start Date",
  // Deposits — 6 columns
  "Prepayment (3300) Amount",
  "Prepayment (3300) Date",
  "Security Deposit (3201) Amount",
  "Security Deposit (3201) Date",
  "Security Deposit (3202) Amount",
  "Security Deposit (3202) Date",
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Total column count
// ─────────────────────────────────────────────────────────────────────────────
describe("APPFOLIO_COLUMNS — total count", () => {
  it("exports exactly 97 columns", () => {
    expect(APPFOLIO_COLUMNS).toHaveLength(97);
  });

  it("oracle TEMPLATE_HEADERS has exactly 97 entries", () => {
    expect(TEMPLATE_HEADERS).toHaveLength(97);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Byte-for-byte match against oracle
// ─────────────────────────────────────────────────────────────────────────────
describe("APPFOLIO_COLUMNS — byte-for-byte oracle match", () => {
  it("matches oracle array exactly (deep equal)", () => {
    expect(APPFOLIO_COLUMNS).toEqual(TEMPLATE_HEADERS);
  });

  // Individual position checks for all 97 columns
  TEMPLATE_HEADERS.forEach((header, idx) => {
    it(`column[${idx}] === "${header}"`, () => {
      expect(APPFOLIO_COLUMNS[idx]).toBe(header);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Base-41 structural checks
// ─────────────────────────────────────────────────────────────────────────────
describe("APPFOLIO_COLUMNS — base 41 columns (indices 0–40)", () => {
  it("first column is 'Unit Name'", () => {
    expect(APPFOLIO_COLUMNS[0]).toBe("Unit Name");
  });

  it("last base column [40] is 'Roommate Move Out 1'", () => {
    expect(APPFOLIO_COLUMNS[40]).toBe("Roommate Move Out 1");
  });

  it("base section contains no 'Charge' headers", () => {
    const base = APPFOLIO_COLUMNS.slice(0, 41);
    expect(base.some((h) => h.startsWith("Charge"))).toBe(false);
  });

  it("base section contains no deposit headers", () => {
    const base = APPFOLIO_COLUMNS.slice(0, 41);
    expect(base.some((h) => h.includes("3300") || h.includes("3201") || h.includes("3202"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Recurring-charge section (indices 41–90, 50 columns)
// ─────────────────────────────────────────────────────────────────────────────
describe("APPFOLIO_COLUMNS — recurring charges (indices 41–90)", () => {
  it("recurring section has exactly 50 columns", () => {
    expect(APPFOLIO_COLUMNS.slice(41, 91)).toHaveLength(50);
  });

  it("first recurring column [41] is 'Charge 1 GL Account Code'", () => {
    expect(APPFOLIO_COLUMNS[41]).toBe("Charge 1 GL Account Code");
  });

  it("last recurring column [90] is 'Charge 10 Start Date'", () => {
    expect(APPFOLIO_COLUMNS[90]).toBe("Charge 10 Start Date");
  });

  // Each of the 10 charge groups has exactly 5 columns in order
  for (let g = 1; g <= 10; g++) {
    const base = 41 + (g - 1) * 5;
    it(`Charge ${g}: index ${base} is 'Charge ${g} GL Account Code'`, () => {
      expect(APPFOLIO_COLUMNS[base]).toBe(`Charge ${g} GL Account Code`);
    });
    it(`Charge ${g}: index ${base + 1} is 'Charge ${g} GL Account Label'`, () => {
      expect(APPFOLIO_COLUMNS[base + 1]).toBe(`Charge ${g} GL Account Label`);
    });
    it(`Charge ${g}: index ${base + 2} is 'Charge ${g} Charge Amount'`, () => {
      expect(APPFOLIO_COLUMNS[base + 2]).toBe(`Charge ${g} Charge Amount`);
    });
    it(`Charge ${g}: index ${base + 3} is 'Charge ${g} Charge Frequency'`, () => {
      expect(APPFOLIO_COLUMNS[base + 3]).toBe(`Charge ${g} Charge Frequency`);
    });
    it(`Charge ${g}: index ${base + 4} is 'Charge ${g} Start Date'`, () => {
      expect(APPFOLIO_COLUMNS[base + 4]).toBe(`Charge ${g} Start Date`);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 5 — Deposit section (indices 91–96, 6 columns)
// ─────────────────────────────────────────────────────────────────────────────
describe("APPFOLIO_COLUMNS — deposit columns (indices 91–96)", () => {
  it("deposit section has exactly 6 columns", () => {
    expect(APPFOLIO_COLUMNS.slice(91)).toHaveLength(6);
  });

  it("column[91] is 'Prepayment (3300) Amount'", () => {
    expect(APPFOLIO_COLUMNS[91]).toBe("Prepayment (3300) Amount");
  });

  it("column[92] is 'Prepayment (3300) Date'", () => {
    expect(APPFOLIO_COLUMNS[92]).toBe("Prepayment (3300) Date");
  });

  it("column[93] is 'Security Deposit (3201) Amount'", () => {
    expect(APPFOLIO_COLUMNS[93]).toBe("Security Deposit (3201) Amount");
  });

  it("column[94] is 'Security Deposit (3201) Date'", () => {
    expect(APPFOLIO_COLUMNS[94]).toBe("Security Deposit (3201) Date");
  });

  it("column[95] is 'Security Deposit (3202) Amount'", () => {
    expect(APPFOLIO_COLUMNS[95]).toBe("Security Deposit (3202) Amount");
  });

  it("column[96] is 'Security Deposit (3202) Date'", () => {
    expect(APPFOLIO_COLUMNS[96]).toBe("Security Deposit (3202) Date");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 6 — No duplicates
// ─────────────────────────────────────────────────────────────────────────────
describe("APPFOLIO_COLUMNS — no duplicates", () => {
  it("all 97 column names are unique", () => {
    const unique = new Set(APPFOLIO_COLUMNS);
    expect(unique.size).toBe(97);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 7 — Sentinel (intentionally skipped — unblocked in Step 4)
// ─────────────────────────────────────────────────────────────────────────────
describe("APPFOLIO_COLUMNS — Step 4 sentinel", () => {
  it.skip("ddValidation module resolves (unblocked in Step 4)", () => {
    // This test is intentionally skipped until src/lib/ddValidation.ts exists.
    expect(true).toBe(true);
  });
});
