import { describe, expect, it } from "vitest";

import { describeMissingPlan, isPlanLocked, lockedPlanId, resolvePlanId, samePlanId } from "../tools/planId.js";

const LOCKED = "5ee4b298-b011-48d5-8343-3b3f50b442f5";
const OTHER = "8531eaeb-158f-4e9a-9ec1-94948011627d";

describe("isPlanLocked", () => {
  it.each(["true", "TRUE", " True "])("treats %j as on", (value) => {
    expect(isPlanLocked({ YNAB_LOCK_PLAN: value })).toBe(true);
  });

  it.each([undefined, "", "false", "1", "yes", "on"])("treats %j as off", (value) => {
    expect(isPlanLocked({ YNAB_LOCK_PLAN: value })).toBe(false);
  });
});

describe("resolvePlanId without the lock", () => {
  it("prefers planId, then budgetId, then YNAB_PLAN_ID, then YNAB_BUDGET_ID", () => {
    const env = { YNAB_PLAN_ID: "env-plan", YNAB_BUDGET_ID: "env-budget" };
    expect(resolvePlanId({ planId: "input-plan", budgetId: "input-budget" }, env)).toBe("input-plan");
    expect(resolvePlanId({ budgetId: "input-budget" }, env)).toBe("input-budget");
    expect(resolvePlanId({}, env)).toBe("env-plan");
    expect(resolvePlanId({}, { YNAB_BUDGET_ID: "env-budget" })).toBe("env-budget");
  });

  it("lets a caller reach a plan other than the configured default", () => {
    expect(resolvePlanId({ planId: OTHER }, { YNAB_PLAN_ID: LOCKED })).toBe(OTHER);
  });

  it("throws when no plan is given or configured", () => {
    expect(() => resolvePlanId({}, {})).toThrow("No plan ID provided");
  });
});

describe("resolvePlanId with the lock", () => {
  const env = { YNAB_PLAN_ID: LOCKED, YNAB_LOCK_PLAN: "true" };

  it("uses the configured plan when none is given", () => {
    expect(resolvePlanId({}, env)).toBe(LOCKED);
  });

  it("accepts the configured plan in any case or padding, and returns the configured spelling", () => {
    expect(resolvePlanId({ planId: LOCKED }, env)).toBe(LOCKED);
    expect(resolvePlanId({ planId: ` ${LOCKED.toUpperCase()} ` }, env)).toBe(LOCKED);
    expect(resolvePlanId({ budgetId: LOCKED.toUpperCase() }, env)).toBe(LOCKED);
  });

  it.each([
    ["planId", { planId: OTHER }],
    ["budgetId", { budgetId: OTHER }],
    ["planId over a matching budgetId", { planId: OTHER, budgetId: LOCKED }],
    ["the last-used alias", { planId: "last-used" }],
    ["the default alias", { planId: "default" }],
  ])("refuses another plan given as %s", (_label, input) => {
    expect(() => resolvePlanId(input, env)).toThrow(/locked to its configured plan \(YNAB_LOCK_PLAN\).*is refused/);
  });

  it("refuses every plan when no plan is configured", () => {
    expect(() => resolvePlanId({}, { YNAB_LOCK_PLAN: "true" })).toThrow("YNAB_PLAN_ID is not set");
    expect(() => resolvePlanId({ planId: OTHER }, { YNAB_LOCK_PLAN: "true" })).toThrow("YNAB_PLAN_ID is not set");
  });

  it.each(["last-used", "default", " Last-Used "])("refuses to anchor the lock on the moving alias %j", (alias) => {
    const aliasEnv = { YNAB_PLAN_ID: alias, YNAB_LOCK_PLAN: "true" };
    expect(() => resolvePlanId({}, aliasEnv)).toThrow("needs YNAB_PLAN_ID to be a plan's ID");
    expect(() => resolvePlanId({ planId: alias }, aliasEnv)).toThrow("needs YNAB_PLAN_ID to be a plan's ID");
  });

  it("honours the deprecated YNAB_BUDGET_ID as the configured plan", () => {
    expect(resolvePlanId({}, { YNAB_BUDGET_ID: LOCKED, YNAB_LOCK_PLAN: "true" })).toBe(LOCKED);
    expect(() => resolvePlanId({ planId: OTHER }, { YNAB_BUDGET_ID: LOCKED, YNAB_LOCK_PLAN: "true" })).toThrow("is refused");
  });

  it("reads process.env by default", () => {
    const saved = { ...process.env };
    try {
      process.env.YNAB_PLAN_ID = LOCKED;
      process.env.YNAB_LOCK_PLAN = "true";
      expect(resolvePlanId()).toBe(LOCKED);
      expect(() => resolvePlanId({ planId: OTHER })).toThrow("is refused");
      expect(lockedPlanId()).toBe(LOCKED);
    } finally {
      process.env = saved;
    }
  });
});

describe("samePlanId", () => {
  it("ignores case and surrounding whitespace only", () => {
    expect(samePlanId(LOCKED, ` ${LOCKED.toUpperCase()}\n`)).toBe(true);
    expect(samePlanId(LOCKED, OTHER)).toBe(false);
    expect(samePlanId(LOCKED, LOCKED.slice(0, -1))).toBe(false);
  });
});

describe("describeMissingPlan", () => {
  const plans = [{ id: OTHER, name: "Samuel's Plan" }];

  it("names the visible plans by default", () => {
    expect(describeMissingPlan(LOCKED, plans)).toContain(`"Samuel's Plan" (${OTHER})`);
  });

  it("names no other plan when listVisible is false", () => {
    const message = describeMissingPlan(LOCKED, plans, { listVisible: false })!;
    expect(message).toContain(`The configured plan ${LOCKED} (YNAB_PLAN_ID) is not one of the plans this YNAB token can access.`);
    expect(message).not.toContain(OTHER);
    expect(message).not.toContain("Samuel's Plan");
  });

  it("returns null when the plan is visible", () => {
    expect(describeMissingPlan(OTHER, plans, { listVisible: false })).toBeNull();
  });
});
