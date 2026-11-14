import { z } from "zod";
import * as ynab from "ynab";
import { getErrorMessage, toolError } from "./errorUtils.js";
import { isPlanLocked, lockedPlanId, samePlanId } from "./planId.js";

export const name = "ynab_list_plans";
export const description = "Lists all available plans from YNAB API";
export const inputSchema = {};

export async function execute(_input: Record<string, unknown>, api: ynab.API) {
  try {
    if (!process.env.YNAB_API_TOKEN) {
      return toolError("YNAB API Token is not set");
    }

    console.error("Listing plans");
    const plansResponse = await api.plans.getPlans();
    console.error(`Found ${plansResponse.data.plans.length} plans`);

    let plans = plansResponse.data.plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
    }));

    // A locked server names only its own plan, never the others the token can see.
    if (isPlanLocked()) {
      const locked = lockedPlanId();
      plans = plans.filter((plan) => samePlanId(plan.id, locked));
      if (plans.length === 0) {
        return toolError(
          "This server is locked to its configured plan (YNAB_LOCK_PLAN), and this YNAB token cannot access that plan. Check YNAB_PLAN_ID.",
        );
      }
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(plans, null, 2) }]
    };
  } catch (error: unknown) {
    console.error("Error listing plans:", error);
    return toolError(getErrorMessage(error));
  }
}