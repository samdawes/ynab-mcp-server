import { afterEach, describe, it, expect, vi } from "vitest";

import { createServer, McpApiHandler } from "../worker/mcp.js";
import { tools } from "../registry.js";
import type { WorkerEnv } from "../worker/env.js";
import { createTestD1 } from "./stubs/d1.js";

const env: WorkerEnv = {
  YNAB_API_TOKEN: "test-token",
  GITHUB_CLIENT_ID: "id",
  GITHUB_CLIENT_SECRET: "secret",
  ALLOWED_GITHUB_LOGIN: "someone",
};

/** Sends one JSON-RPC message to the Worker's /mcp handler. */
async function call(body: unknown, overrides: Partial<WorkerEnv> = {}) {
  const request = new Request("https://example.com/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  return McpApiHandler.fetch(request, { ...env, ...overrides });
}

/** The handler may answer as JSON or as a single SSE frame; accept both. */
async function readResult(response: Response) {
  const text = await response.text();
  const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
  return JSON.parse(dataLine ? dataLine.slice(5).trim() : text);
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  },
};

describe("worker MCP handler", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("mirrors plan environment aliases without resolving them", async () => {
    vi.stubEnv("YNAB_PLAN_ID", "original-plan");
    vi.stubEnv("YNAB_BUDGET_ID", "original-budget");

    const legacyOnlyServer = createServer({ ...env, YNAB_BUDGET_ID: "legacy-plan" });
    expect(process.env.YNAB_PLAN_ID).toBeUndefined();
    expect(process.env.YNAB_BUDGET_ID).toBe("legacy-plan");
    await legacyOnlyServer.close();

    const bothServer = createServer({
      ...env,
      YNAB_PLAN_ID: "canonical-plan",
      YNAB_BUDGET_ID: "legacy-plan",
    });
    expect(process.env.YNAB_PLAN_ID).toBe("canonical-plan");
    expect(process.env.YNAB_BUDGET_ID).toBe("legacy-plan");
    await bothServer.close();
  });

  it("mirrors the typical-payees opt-in and clears it when the binding is absent", async () => {
    vi.stubEnv("YNAB_AI_TYPICAL_PAYEES", "stale");

    const optedIn = createServer({ ...env, YNAB_AI_TYPICAL_PAYEES: "true" });
    expect(process.env.YNAB_AI_TYPICAL_PAYEES).toBe("true");
    await optedIn.close();

    const optedOut = createServer(env);
    expect(process.env.YNAB_AI_TYPICAL_PAYEES).toBeUndefined();
    await optedOut.close();
  });

  it("mirrors the plan lock and clears it when the binding is absent", async () => {
    vi.stubEnv("YNAB_LOCK_PLAN", "stale");

    const locked = createServer({ ...env, YNAB_LOCK_PLAN: "true" });
    expect(process.env.YNAB_LOCK_PLAN).toBe("true");
    await locked.close();

    const unlocked = createServer(env);
    expect(process.env.YNAB_LOCK_PLAN).toBeUndefined();
    await unlocked.close();
  });

  it("serves only the locked plan over MCP", async () => {
    const LOCKED = "5ee4b298-b011-48d5-8343-3b3f50b442f5";
    const lockEnv = { YNAB_PLAN_ID: LOCKED, YNAB_LOCK_PLAN: "true", YNAB_READ_ONLY: "true" };
    const requested: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requested.push(new URL(url).pathname);
      if (new URL(url).pathname === "/v1/plans") {
        return Response.json({
          data: {
            plans: [
              { id: "fd7c1d9a-e5ba-4fe0-a926-6afb6836b9b0", name: "My Budget" },
              { id: LOCKED, name: "2026" },
              { id: "8531eaeb-158f-4e9a-9ec1-94948011627d", name: "Samuel's Plan" },
            ],
          },
        });
      }
      return Response.json({ data: { accounts: [], server_knowledge: 1 } });
    });
    const callTool = async (name: string, args: Record<string, unknown>) =>
      (await readResult(await call({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } }, lockEnv))).result;

    const listed = await callTool("ynab_list_plans", {});
    expect(JSON.parse(listed.content[0].text)).toEqual([{ id: LOCKED, name: "2026" }]);

    const beforeRefusal = requested.length;
    const refused = await callTool("ynab_list_accounts", { planId: "8531eaeb-158f-4e9a-9ec1-94948011627d" });
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain("is refused");
    expect(requested).toHaveLength(beforeRefusal);

    const allowed = await callTool("ynab_list_accounts", {});
    expect(allowed.isError).toBeUndefined();

    // Apart from listing plans, every YNAB request stayed inside the locked plan.
    const planScoped = requested.filter((path) => path !== "/v1/plans");
    expect(planScoped.length).toBeGreaterThan(0);
    for (const path of planScoped) expect(path.startsWith(`/v1/plans/${LOCKED}/`)).toBe(true);
  });

  it("responds to initialize over HTTP", async () => {
    const response = await call(initialize);
    expect(response.status).toBe(200);

    const result = await readResult(response);
    expect(result.result.serverInfo).toEqual({
      name: "ynab-mcp-server",
      version: "0.9.0",
    });
  });

  it("serves every tool", async () => {
    const response = await call({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const result = await readResult(response);

    const names = result.result.tools.map((t: { name: string }) => t.name);
    expect(names).toHaveLength(tools.filter((tool) => !tool.requiresAiCategorization).length);
    expect(names).toContain("ynab_plan_summary");
    expect(names).not.toContain("ynab_budget_summary");
    expect(names).toContain("ynab_create_transaction");
    expect(names).not.toContain("ynab_suggest_categories");
  });

  it("answers concurrent requests that reuse a JSON-RPC id with their own results", async () => {
    const listTools = { jsonrpc: "2.0", id: 0, method: "tools/list" };
    const [full, readOnly] = await Promise.all([
      call(listTools).then(readResult),
      call(listTools, { YNAB_READ_ONLY: "true" }).then(readResult),
    ]);

    const names = (result: any) => result.result.tools.map((t: { name: string }) => t.name);
    expect(names(full)).toContain("ynab_create_transaction");
    expect(names(readOnly)).not.toContain("ynab_create_transaction");
  });

  it("rejects a request body over the configured 1 MiB limit", async () => {
    const response = await call({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
      params: { padding: "x".repeat(1024 * 1024) },
    });
    expect(response.status).toBe(413);
  });

  it("rejects oversized tool arguments before calling YNAB", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await call({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "ynab_create_transaction",
        arguments: {
          planId: "plan",
          accountId: "account",
          date: "2026-01-01",
          amount: 0,
          payeeName: "Payee",
          subtransactions: Array.from({ length: 20_000 }, () => ({ amount: 0 })),
        },
      },
    });
    const result = await readResult(response);

    expect(response.status).toBe(200);
    expect(result.result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringContaining("maximum of 10000 elements") }],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("exposes category suggestions only with both opt-in settings", async () => {
    const onlyFlag = await call(
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      { YNAB_AI_CATEGORIZATION: "true" },
    );
    const onlyFlagResult = await readResult(onlyFlag);
    expect(onlyFlagResult.result.tools.map((t: { name: string }) => t.name)).not.toContain("ynab_suggest_categories");

    const enabled = await call(
      { jsonrpc: "2.0", id: 4, method: "tools/list" },
      { YNAB_AI_CATEGORIZATION: "true", TYPESAFE_API_KEY: "typesafe-secret", YNAB_READ_ONLY: "true" },
    );
    const enabledResult = await readResult(enabled);
    const names = enabledResult.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("ynab_suggest_categories");
    expect(names).not.toContain("ynab_create_transaction");
  });

  it("hides write tools when YNAB_READ_ONLY is true", async () => {
    const response = await call(
      { jsonrpc: "2.0", id: 5, method: "tools/list" },
      { YNAB_READ_ONLY: "true" },
    );
    const result = await readResult(response);

    const names = result.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("ynab_plan_summary");
    expect(names).not.toContain("ynab_budget_summary");
    expect(names).not.toContain("ynab_create_transaction");
    expect(names).not.toContain("ynab_delete_transaction");
  });

  it("refuses a write tool called by name in read-only mode, without contacting YNAB", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const writeTools = tools.filter((tool) => tool.writes).map((tool) => tool.module.name);
    expect(writeTools.length).toBeGreaterThan(0);

    for (const name of writeTools) {
      const response = await call(
        { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name, arguments: { planId: "plan", transactionId: "t1" } } },
        { YNAB_READ_ONLY: "true" },
      );
      const result = await readResult(response);
      expect(result.result, name).toBeUndefined();
      expect(result.error?.message, name).toBe(`Tool ${name} not found`);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("serves the auto-budget tools only with their database bound, read-only mode included", async () => {
    const autobudget = ["ynab_autobudget_status", "ynab_autobudget_plan", "ynab_autobudget_pause"];
    const names = async (overrides: Partial<WorkerEnv>) =>
      (await readResult(await call({ jsonrpc: "2.0", id: 6, method: "tools/list" }, overrides)))
        .result.tools.map((t: { name: string }) => t.name);

    expect(await names({})).not.toContain("ynab_autobudget_status");
    const bound = await names({ AUTOBUDGET_DB: createTestD1(), YNAB_READ_ONLY: "true" });
    expect(bound).toEqual(expect.arrayContaining(autobudget));
  });
});
