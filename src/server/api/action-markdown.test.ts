import type { ActionDefinition, JsonSchema } from "../../core/types.ts";

import { describe, expect, it } from "vitest";
import { jsonSchema } from "../../core/json-schema.ts";
import { validateActionInput } from "../../core/validation.ts";
import { renderActionMarkdown } from "./action-markdown.ts";

const action: ActionDefinition = {
  id: "github.delete_repository",
  service: "github",
  name: "delete_repository",
  description: "Delete a repository.",
  operationType: "destructive",
  requiredScopes: [],
  providerPermissions: [],
  inputSchema: { type: "object", properties: { repo: { type: "string" } }, required: ["repo"] },
  outputSchema: { type: "object" },
};

describe("renderActionMarkdown", () => {
  function exampleInput(inputSchema: JsonSchema): Record<string, unknown> {
    const markdown = renderActionMarkdown({ ...action, inputSchema }, { transport: { kind: "mcp" } });
    const match = markdown.match(/```json\n([\s\S]*?)\n```/);
    if (!match) throw new Error("example input not found");
    return (JSON.parse(match[1]) as { input: Record<string, unknown> }).input;
  }

  function expectValidExample(label: string, inputSchema: JsonSchema): Record<string, unknown> {
    const example = exampleInput(inputSchema);
    const result = validateActionInput({ ...action, inputSchema }, example);
    expect(result.valid, `${label}: ${JSON.stringify(example)}`).toBe(true);
    return example;
  }

  it("renders HTTP request examples against the caller's public origin", () => {
    const markdown = renderActionMarkdown(action, {
      transport: { kind: "http", origin: "https://connector.example.com" },
    });

    expect(markdown).toContain("## Execute");
    expect(markdown).toContain(
      "curl -s https://connector.example.com/v1/actions/github.delete_repository \\\n" +
        "  -H 'content-type: application/json' \\\n" +
        `  -d '{"input":{"repo":""}}'`,
    );
    expect(markdown).toContain('fetch("https://connector.example.com/v1/actions/github.delete_repository"');
    expect(markdown).toContain("Use the runtime endpoint above");
    expect(markdown).not.toContain("localhost");
    expect(markdown).not.toContain("execute_action");
  });

  it("keeps the curl example valid when an example value contains an apostrophe", () => {
    const markdown = renderActionMarkdown(
      {
        ...action,
        inputSchema: {
          type: "object",
          properties: { owner: { type: "string", default: "O'Reilly" } },
          required: ["owner"],
        },
      },
      { transport: { kind: "http", origin: "https://connector.example.com" } },
    );

    expect(markdown).toContain(`  -d '{"input":{"owner":"O'\\''Reilly"}}'`);
  });

  it("renders an execute_action example for MCP callers instead of HTTP requests", () => {
    const markdown = renderActionMarkdown(action, { transport: { kind: "mcp" } });

    expect(markdown).toContain("Call the `execute_action` tool with these arguments:");
    expect(markdown).toContain(
      "```json\n" + JSON.stringify({ actionId: "github.delete_repository", input: { repo: "" } }, null, 2) + "\n```",
    );
    expect(markdown).toContain("Add `connectionName` to run the action with a named connection");
    expect(markdown).toContain("Use the `execute_action` tool above");
    expect(markdown).not.toContain("curl");
    expect(markdown).not.toContain("fetch(");
    expect(markdown).not.toContain("localhost");
  });

  it("generates an example that satisfies the action's own input schema", () => {
    expectValidExample("minLength", {
      type: "object",
      properties: { name: { type: "string", minLength: 1 } },
      required: ["name"],
    });
    expectValidExample("pattern", {
      type: "object",
      properties: { name: { type: "string", pattern: "\\S" } },
      required: ["name"],
    });
    for (const format of ["email", "date", "date-time", "uri", "uuid", "ipv4", "ipv6"]) {
      expectValidExample(format, {
        type: "object",
        properties: { value: { type: "string", format } },
        required: ["value"],
      });
    }
    expectValidExample("minimum", {
      type: "object",
      properties: { limit: { type: "number", minimum: 5 } },
      required: ["limit"],
    });
  });

  it("generates an example that satisfies the action's structural constraints", () => {
    const nullable = expectValidExample("nullable number", {
      type: "object",
      properties: { count: { anyOf: [{ type: "number" }, { type: "null" }] } },
      required: ["count"],
    });
    expect(typeof nullable.count).toBe("number");

    const exactlyOne = expectValidExample("exactly one property", {
      type: "object",
      properties: { mermaid: { type: "string" }, xml: { type: "string" } },
      oneOf: [{ required: ["mermaid"] }, { required: ["xml"] }],
    });
    expect(Object.keys(exactlyOne)).toHaveLength(1);

    const array = expectValidExample("minItems", {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" }, minItems: 1 } },
      required: ["ids"],
    });
    expect(Array.isArray(array.ids) && array.ids.length >= 1).toBe(true);

    const nested = expectValidExample("nested required", {
      type: "object",
      properties: {
        config: { type: "object", properties: { host: { type: "string", minLength: 1 } }, required: ["host"] },
      },
      required: ["config"],
    });
    expect(nested.config).toEqual(expect.objectContaining({ host: expect.any(String) }));

    const oneOfByShape = expectValidExample("oneOf shapes", {
      oneOf: [
        {
          type: "object",
          properties: { map_id: { type: "string", minLength: 1 }, project_id: { type: "string", minLength: 1 } },
          additionalProperties: false,
        },
        {
          type: "object",
          properties: { map_id: { type: "string", minLength: 1 }, folder_id: { type: "string", minLength: 1 } },
          additionalProperties: false,
        },
      ],
    });
    expect(Object.keys(oneOfByShape)).toContain("project_id");

    const allOf = expectValidExample("allOf member requirement", {
      type: "object",
      required: ["id"],
      allOf: [
        {
          oneOf: [
            { required: ["sheetId"], not: { required: ["sheetName"] } },
            { required: ["sheetName"], not: { required: ["sheetId"] } },
          ],
        },
      ],
    });
    expect("sheetId" in allOf || "sheetName" in allOf).toBe(true);

    const map = expectValidExample("additionalProperties minProperties", {
      type: "object",
      properties: { attributes: { type: "object", additionalProperties: { type: "string" }, minProperties: 1 } },
      required: ["attributes"],
    });
    expect(Object.keys(map.attributes as Record<string, unknown>).length).toBeGreaterThanOrEqual(1);
  });

  it("generates an example that satisfies tuple, bound, and discriminator constraints", () => {
    const bounded = expectValidExample("combined numeric bounds", {
      type: "object",
      properties: { value: { type: "number", minimum: 0, exclusiveMinimum: 2, maximum: 3 } },
      required: ["value"],
    });
    expect(bounded.value).toBeGreaterThan(2);

    const integer = expectValidExample("combined integer bounds", {
      type: "object",
      properties: { value: { type: "integer", minimum: 0, exclusiveMinimum: 2, maximum: 3 } },
      required: ["value"],
    });
    expect(integer.value).toBe(3);

    const tuple = expectValidExample("tuple filled to minItems", {
      type: "object",
      properties: {
        pair: { type: "array", prefixItems: [{ type: "string" }], items: { type: "string" }, minItems: 2 },
      },
      required: ["pair"],
    });
    expect((tuple.pair as unknown[]).length).toBe(2);

    const long = expectValidExample("minItems beyond the display cap", {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" }, minItems: 5 } },
      required: ["ids"],
    });
    expect((long.ids as unknown[]).length).toBe(5);

    const longString = expectValidExample("minLength beyond the display cap", {
      type: "object",
      properties: { token: { type: "string", minLength: 100 } },
      required: ["token"],
    });
    expect((longString.token as string).length).toBe(100);

    const minProperties = expectValidExample("minProperties with named and additional properties", {
      type: "object",
      properties: { name: { type: "string" } },
      additionalProperties: { type: "string" },
      minProperties: 2,
    });
    expect(Object.keys(minProperties).length).toBe(2);

    const discriminated = expectValidExample("discriminated oneOf branch", {
      type: "object",
      required: ["kind"],
      properties: { kind: { const: "folder" } },
      oneOf: [
        { required: ["fileId"], properties: { kind: { const: "file" }, fileId: { type: "string" } } },
        { required: ["folderId"], properties: { kind: { const: "folder" }, folderId: { type: "string" } } },
      ],
    });
    expect(discriminated.kind).toBe("folder");
    expect("folderId" in discriminated).toBe(true);
  });

  it("generates an example that satisfies merged allOf, format bounds, and item bounds", () => {
    const allOfProperty = expectValidExample("allOf member property constraint", {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
      allOf: [{ properties: { name: { type: "string", minLength: 1 } } }],
    });
    expect(allOfProperty.name).not.toBe("");

    const email = expectValidExample("formatted string length bounds", {
      type: "object",
      properties: { email: { type: "string", format: "email", minLength: 17, maxLength: 17 } },
      required: ["email"],
    });
    expect((email.email as string).length).toBe(17);

    const uri = expectValidExample("formatted uri minimum length", {
      type: "object",
      properties: { callback: { type: "string", format: "uri", minLength: 24 } },
      required: ["callback"],
    });
    expect((uri.callback as string).length).toBe(24);

    const scores = expectValidExample("unique numeric items with a minimum", {
      type: "object",
      properties: {
        scores: { type: "array", items: { type: "integer", minimum: 10 }, minItems: 2, uniqueItems: true },
      },
      required: ["scores"],
    });
    expect(scores.scores).toEqual([10, 11]);

    const hostname = expectValidExample("hostname with a long minimum", {
      type: "object",
      properties: { host: { type: "string", format: "hostname", minLength: 80 } },
      required: ["host"],
    });
    const labels = (hostname.host as string).split(".");
    expect(labels.every((label) => label.length <= 63)).toBe(true);
    expect((hostname.host as string).length).toBeGreaterThanOrEqual(80);

    const tags = expectValidExample("unique string items with a minimum length", {
      type: "object",
      properties: { tags: { type: "array", items: { type: "string", minLength: 2 }, minItems: 2, uniqueItems: true } },
      required: ["tags"],
    });
    expect(tags.tags).toEqual(["aa", "bb"]);
  });

  it("satisfies sibling anyOf and oneOf requirements", () => {
    expectValidExample("both combinators", {
      type: "object",
      properties: {
        url: { type: "string", format: "uri" },
        html: { type: "string", minLength: 1 },
        prompt: { type: "string", minLength: 1 },
        responseFormat: { type: "object" },
      },
      oneOf: [{ required: ["url"] }, { required: ["html"] }],
      anyOf: [{ required: ["prompt"] }, { required: ["responseFormat"] }],
    });
  });

  it("selects a required-property branch without seeding forbidden optional fields", () => {
    expectValidExample("optional default branch", {
      type: "object",
      properties: { chainId: { type: "integer" }, network: { type: "string" } },
      oneOf: [
        { not: { anyOf: [{ required: ["chainId"] }, { required: ["network"] }] } },
        { required: ["chainId"], not: { required: ["network"] } },
        { required: ["network"], not: { required: ["chainId"] } },
      ],
    });
  });

  it("keeps the first anyOf object candidate when later branches require fields", () => {
    const text = { type: "object", properties: { text: { type: "string" } }, additionalProperties: false };
    expectValidExample("array with an optional-field object variant", {
      type: "object",
      properties: {
        content: {
          type: "array",
          minItems: 1,
          contains: text,
          items: { anyOf: [text, { type: "object", properties: { image: { type: "string" } }, required: ["image"] }] },
        },
      },
      required: ["content"],
    });
  });

  it("preserves nested union constraints when selecting a branch", () => {
    expectValidExample("nested anyOf", {
      type: "object",
      properties: {
        to: {
          anyOf: [
            { anyOf: [{ type: "string", minLength: 1 }, { type: "number" }] },
            { type: "array", items: { type: "string" }, minItems: 1 },
          ],
        },
      },
      required: ["to"],
    });
  });

  it("preserves object requirements inside a selected branch", () => {
    expectValidExample("nested object combinators", {
      type: "object",
      properties: {
        message: {
          type: "object",
          properties: { html: { type: "string" }, text: { type: "string" }, template: { type: "string" } },
          oneOf: [{ anyOf: [{ required: ["html"] }, { required: ["text"] }] }, { required: ["template"] }],
        },
      },
      required: ["message"],
    });
  });

  it("distinguishes nested oneOf object branches without required properties", () => {
    const example = expectValidExample("nested oneOf shapes", {
      type: "object",
      properties: {
        permission: {
          oneOf: [
            { type: "object", properties: { mode: { const: "all" } }, additionalProperties: false },
            { type: "object", properties: { mode: { const: "none" } }, additionalProperties: false },
          ],
        },
      },
      required: ["permission"],
    });
    expect(example.permission).toEqual({ mode: "all" });
  });

  it.each([true, undefined])(
    "fills open maps with minProperties when additionalProperties is %s",
    (additionalProperties) => {
      expectValidExample("open map", {
        type: "object",
        properties: { filters: { type: "object", additionalProperties, minProperties: 1 } },
        required: ["filters"],
      });
    },
  );

  it("renders the current execution policy decision and decisive rule", () => {
    const markdown = renderActionMarkdown(action, {
      transport: { kind: "mcp" },
      policy: {
        allowed: false,
        code: "action_blocked",
        message: "Action is blocked.",
        checks: [{ source: "runtime", outcome: "block_match", rule: "github.delete_repository" }],
      },
    });

    expect(markdown).toContain("## Execution Policy");
    expect(markdown).toContain("Denied: Action is blocked.");
    expect(markdown).toContain("`runtime`: `block_match` via `github.delete_repository`");
  });

  it("renders the description of a nullable property", () => {
    const markdown = renderActionMarkdown(
      {
        ...action,
        inputSchema: {
          type: "object",
          properties: { name: jsonSchema.nullableString("The nullable display name.") },
          required: ["name"],
        },
      },
      { transport: { kind: "mcp" } },
    );

    expect(markdown).toContain("The nullable display name.");
  });
});
