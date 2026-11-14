export interface PlanIdInput { planId?: string; budgetId?: string; }

/** The settings the plan helpers read, `process.env` unless given. */
export interface PlanEnv {
  YNAB_PLAN_ID?: string;
  YNAB_BUDGET_ID?: string;
  YNAB_LOCK_PLAN?: string;
}

/** YNAB path aliases that resolve to a different plan over time, so they cannot anchor a lock. */
const MOVING_PLAN_ALIASES = new Set(["last-used", "default"]);

/**
 * Resolve the canonical plan identifier with legacy compatibility. With
 * YNAB_LOCK_PLAN on, only the configured plan resolves: a request for any
 * other plan throws, and the configured ID is returned rather than the
 * caller's spelling of it.
 */
export function resolvePlanId(input: PlanIdInput = {}, env: PlanEnv = process.env): string {
  const requested = input.planId || input.budgetId;
  if (isPlanLocked(env)) {
    const locked = lockedPlanId(env);
    if (requested && !samePlanId(requested, locked)) {
      throw new Error(
        `This server is locked to its configured plan (YNAB_LOCK_PLAN), so plan "${requested}" is refused. ` +
          "Omit planId to use the configured plan.",
      );
    }
    return locked;
  }
  const planId = requested || configuredPlanId(env) || "";
  if (!planId) throw new Error("No plan ID provided. Please provide planId or set the YNAB_PLAN_ID environment variable.");
  return planId;
}

/** The configured default plan, as `resolvePlanId` falls back to it. */
export function configuredPlanId(env: PlanEnv = process.env): string | undefined {
  return env.YNAB_PLAN_ID || env.YNAB_BUDGET_ID || undefined;
}

/** True when YNAB_LOCK_PLAN asks to pin every call to the configured plan: "true" in any case, surrounding whitespace ignored. */
export function isPlanLocked(env: PlanEnv = process.env): boolean {
  return env.YNAB_LOCK_PLAN?.trim().toLowerCase() === "true";
}

/**
 * The one plan a locked server serves. Throws instead of falling back when no
 * plan is configured, or when it is an alias YNAB can resolve to a different
 * plan over time, so a misconfigured lock refuses every plan.
 */
export function lockedPlanId(env: PlanEnv = process.env): string {
  const planId = configuredPlanId(env);
  if (!planId) {
    throw new Error(
      "YNAB_LOCK_PLAN is on but YNAB_PLAN_ID is not set, so every plan is refused. Set YNAB_PLAN_ID to the plan this server may use.",
    );
  }
  if (MOVING_PLAN_ALIASES.has(planId.trim().toLowerCase())) {
    throw new Error(
      `YNAB_LOCK_PLAN needs YNAB_PLAN_ID to be a plan's ID, not "${planId}", which YNAB can resolve to a different plan over time.`,
    );
  }
  return planId;
}

/** Plan IDs are UUIDs, so two spellings name the same plan when they match ignoring case and surrounding whitespace. */
export function samePlanId(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Explains a configured plan the token cannot see, or returns null when the
 * plan is among `plans`. A stale or mistyped YNAB_PLAN_ID otherwise surfaces
 * only as YNAB's bare "Resource not found" on every call that relies on it.
 * With `listVisible: false` (a locked server) the other plans go unnamed.
 */
export function describeMissingPlan(
  planId: string,
  plans: Array<{ id: string; name: string }>,
  options: { listVisible?: boolean } = {},
): string | null {
  if (plans.some((plan) => plan.id === planId)) return null;
  const missing = `The configured plan ${planId} (YNAB_PLAN_ID) is not one of the plans this YNAB token can access.`;
  if (options.listVisible === false) return `${missing} Set YNAB_PLAN_ID to a plan this token can access.`;
  const visible = plans.length
    ? plans.map((plan) => `"${plan.name}" (${plan.id})`).join(", ")
    : "none";
  return `${missing} Plans it can access: ${visible}. Set YNAB_PLAN_ID to one of these, or pass planId.`;
}
