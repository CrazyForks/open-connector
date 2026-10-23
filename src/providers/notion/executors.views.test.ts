import type { ExecutionContext } from "../../core/types.ts";

import { Validator } from "@cfworker/json-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateActionInput } from "../../core/validation.ts";
import { notionActions } from "./actions.ts";
import { executors } from "./executors.ts";

const DATABASE = "4b9f3aaa-6d53-41da-9cc6-fddf3d3d8e0a";
const DATA_SOURCE = "f4e0233b-211c-45f6-a082-a6b2b39d38a1";
const VIEW = "13eb43c2-5ae4-4261-afac-fd6f14ef94c8";
const context: ExecutionContext = {
  getCredential: async () => ({
    authType: "api_key",
    apiKey: "ntn_test",
    values: { apiKey: "ntn_test" },
    metadata: {},
    profile: { accountId: "bot", displayName: "Test", grantedScopes: [] },
  }),
};
const savedView = {
  object: "view",
  id: VIEW,
  parent: { type: "database_id", database_id: DATABASE },
  data_source_id: DATA_SOURCE,
  name: "Active projects",
  type: "table",
  filter: { property: "Status", status: { equals: "In progress" } },
  sorts: [{ property: "Priority", direction: "ascending" }],
  configuration: {
    type: "table",
    properties: [
      { property_id: "title", visible: true, width: 300 },
      { property_id: "status", visible: false },
    ],
    group_by: null,
    wrap_cells: false,
  },
  request_id: "request-1",
};

afterEach(() => vi.unstubAllGlobals());

describe("Notion saved views", () => {
  it("lists database view references and follows the returned cursor", async () => {
    const reference = { object: "view", id: VIEW };
    const first = {
      object: "list",
      results: [reference],
      has_more: true,
      next_cursor: "cursor-2",
      type: "view",
      view: {},
    };
    const second = { object: "list", results: [], has_more: false, next_cursor: null };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(first)).mockResolvedValueOnce(Response.json(second));
    vi.stubGlobal("fetch", fetcher);

    expect(await executors["notion.list_views"]!({ databaseId: DATABASE, pageSize: 1 }, context)).toEqual({
      ok: true,
      output: first,
    });
    expect(
      await executors["notion.list_views"]!(
        { databaseId: DATABASE, pageSize: 1, startCursor: first.next_cursor },
        context,
      ),
    ).toEqual({
      ok: true,
      output: second,
    });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      `https://api.notion.com/v1/views?database_id=${DATABASE}&page_size=1`,
      `https://api.notion.com/v1/views?database_id=${DATABASE}&page_size=1&start_cursor=cursor-2`,
    ]);
    const init = fetcher.mock.calls[0]![1];
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer ntn_test");
    expect(new Headers(init.headers).get("notion-version")).toBe("2026-03-11");
    const action = notionActions.find((action) => action.name === "list_views")!;
    expect(new Validator(action.outputSchema).validate(first).valid).toBe(true);
  });

  it("can list accessible linked views by data source without a database ID", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ object: "list", results: [], has_more: false, next_cursor: null }));
    vi.stubGlobal("fetch", fetcher);
    await executors["notion.list_views"]!({ dataSourceId: DATA_SOURCE }, context);
    expect(String(fetcher.mock.calls[0]![0])).toBe(`https://api.notion.com/v1/views?data_source_id=${DATA_SOURCE}`);
  });

  it("rejects unscoped listing and missing view IDs before requesting Notion", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const name of ["list_views", "retrieve_view", "update_view"]) {
      expect(await executors[`notion.${name}`]!({}, context)).toMatchObject({
        ok: false,
        error: { details: { status: 400 } },
      });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("retrieves full settings without losing filters, sorting, column order, or unknown fields", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(savedView));
    vi.stubGlobal("fetch", fetcher);
    expect(await executors["notion.retrieve_view"]!({ viewId: VIEW }, context)).toEqual({
      ok: true,
      output: savedView,
    });
    expect(String(fetcher.mock.calls[0]![0])).toBe(`https://api.notion.com/v1/views/${VIEW}`);
    expect(fetcher.mock.calls[0]![1].method).toBe("GET");
    const action = notionActions.find((action) => action.name === "retrieve_view")!;
    expect(new Validator(action.outputSchema).validate(savedView).valid).toBe(true);
  });

  it.each(["retrieve_view", "update_view"])("encodes the %s path ID as one segment", async (name) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(savedView));
    vi.stubGlobal("fetch", fetcher);
    await executors[`notion.${name}`]!({ viewId: "view/id?query#fragment" }, context);
    expect(String(fetcher.mock.calls[0]![0])).toBe("https://api.notion.com/v1/views/view%2Fid%3Fquery%23fragment");
  });

  it("patches only supplied settings and preserves nested nulls, false values, and column order", async () => {
    const updates = {
      name: " Review projects ",
      filter: savedView.filter,
      sorts: savedView.sorts,
      quick_filters: { Owner: null },
      configuration: savedView.configuration,
    };
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...savedView, ...updates }));
    vi.stubGlobal("fetch", fetcher);
    expect(await executors["notion.update_view"]!({ viewId: VIEW, ...updates }, context)).toEqual({
      ok: true,
      output: { ...savedView, ...updates },
    });
    expect(String(fetcher.mock.calls[0]![0])).toBe(`https://api.notion.com/v1/views/${VIEW}`);
    const init = fetcher.mock.calls[0]![1];
    expect(init.method).toBe("PATCH");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual(updates);
  });

  it("forwards explicit null to clear filters and sorting while leaving omitted settings unchanged", async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json(savedView));
    vi.stubGlobal("fetch", fetcher);
    await executors["notion.update_view"]!({ viewId: VIEW, filter: null, sorts: null, quick_filters: null }, context);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ filter: null, sorts: null, quick_filters: null });
    await executors["notion.update_view"]!({ viewId: VIEW, name: "Renamed" }, context);
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual({ name: "Renamed" });
  });

  it("validates and forwards null to clear displayed-property configuration", async () => {
    const action = notionActions.find((action) => action.name === "update_view")!;
    const configuration = { type: "table", properties: null };
    const input = { viewId: VIEW, configuration };
    expect(validateActionInput(action, input).valid).toBe(true);

    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...savedView, configuration }));
    vi.stubGlobal("fetch", fetcher);
    expect(await executors["notion.update_view"]!(input, context)).toMatchObject({ ok: true });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ configuration });
  });

  it("accepts positive integer column widths and rejects zero, negative, and fractional widths", () => {
    const action = notionActions.find((action) => action.name === "update_view")!;
    for (const width of [1, 300, 0, -1, 1.5]) {
      const input = {
        viewId: VIEW,
        configuration: { type: "table", properties: [{ property_id: "title", width }] },
      };
      expect(validateActionInput(action, input).valid, `width ${width}`).toBe(width === 1 || width === 300);
    }
  });

  it("validates list targets and pagination and accepts both documented scopes", () => {
    const action = notionActions.find((action) => action.name === "list_views")!;
    const valid = (input: Record<string, unknown>) => validateActionInput(action, input).valid;
    expect(valid({ databaseId: DATABASE })).toBe(true);
    expect(valid({ dataSourceId: DATA_SOURCE })).toBe(true);
    expect(valid({ databaseId: DATABASE, dataSourceId: DATA_SOURCE, pageSize: 100, startCursor: "next" })).toBe(true);
    for (const input of [
      {},
      { databaseId: "" },
      { databaseId: DATABASE, pageSize: 101 },
      { databaseId: DATABASE, pageSize: 0 },
    ]) {
      expect(valid(input)).toBe(false);
    }
  });

  it("accepts nullable updates and rejects unsupported sort and configuration shapes", () => {
    const action = notionActions.find((action) => action.name === "update_view")!;
    const valid = (input: Record<string, unknown>) => validateActionInput(action, { viewId: VIEW, ...input }).valid;
    expect(valid({ filter: null, sorts: null, quick_filters: null })).toBe(true);
    expect(valid({ configuration: savedView.configuration, sorts: savedView.sorts })).toBe(true);
    expect(valid({ quick_filters: { Owner: null } })).toBe(true);
    expect(valid({ configuration: {} })).toBe(false);
    expect(valid({ configuration: null })).toBe(false);
    expect(valid({ configuration: { type: "dashboard" } })).toBe(false);
    expect(valid({ sorts: [{ timestamp: "created_time", direction: "descending" }] })).toBe(false);
    expect(valid({ sorts: [{ property: "Status", direction: "backwards" }] })).toBe(false);
    expect(valid({ sorts: [{ property: "Status" }] })).toBe(false);
    expect(valid({ sorts: Array.from({ length: 101 }, () => ({ property: "Status", direction: "ascending" })) })).toBe(
      false,
    );
  });

  it("declares read permissions for inspection and only update permission for mutations", () => {
    for (const name of ["list_views", "retrieve_view"]) {
      expect(notionActions.find((action) => action.name === name)).toMatchObject({
        operationType: "read",
        requiredScopes: ["read_content"],
      });
    }
    expect(notionActions.find((action) => action.name === "update_view")).toMatchObject({
      operationType: "destructive",
      requiredScopes: ["update_content"],
    });
  });

  it.each([403, 404, 429])("preserves Notion HTTP %i errors", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { object: "error", message: "Notion refused this view request." },
            { status, headers: { "retry-after": "17" } },
          ),
        ),
    );
    const result = await executors["notion.retrieve_view"]!({ viewId: VIEW }, context);
    expect(result).toMatchObject({
      ok: false,
      error: { message: "Notion refused this view request.", details: { status } },
    });
    if (status === 429) expect(result).toMatchObject({ error: { details: { details: { retryAfterSeconds: 17 } } } });
  });
});
