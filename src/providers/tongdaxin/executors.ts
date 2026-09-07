import type { CredentialValidators, ProviderExecutors } from "../../core/types.ts";
import type { ApiKeyProviderContext, ProviderActionHandlers, ProviderRuntimeHandler } from "../provider-runtime.ts";
import type { Client } from "@modelcontextprotocol/client";

import { ProtocolError, SdkHttpError, UnauthorizedError } from "@modelcontextprotocol/client";
import { createHash } from "node:crypto";
import { optionalRecord } from "../../core/cast.ts";
import { withMcpClient } from "../mcp-client.ts";
import {
  defineApiKeyProviderExecutors,
  providerUserAgent,
  ProviderRequestError,
  requiredInputString,
} from "../provider-runtime.ts";
import { tongdaxinReadOnlyToolNames } from "./actions.ts";

const service = "tongdaxin";
const endpoint = new URL("https://txmcp.tdx.com.cn:3001/txmcp");
const requestTimeoutMs = 60_000;
const supportedToolNames = new Set(tongdaxinReadOnlyToolNames);

interface TongdaxinTool {
  name: string;
  description?: string;
  annotations?: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
}

const handlers: ProviderActionHandlers<typeof service, ProviderRuntimeHandler<ApiKeyProviderContext>> = {
  async list_tools(_input, context) {
    return { tools: await discoverSupportedTools(context, "execute") };
  },
  async call_tool(input, context) {
    const toolName = requiredInputString(input.toolName, "toolName");
    const argumentsValue = input.arguments === undefined ? {} : optionalRecord(input.arguments);
    if (!argumentsValue) throw new ProviderRequestError(400, "arguments must be a JSON object");
    const tools = await discoverSupportedTools(context, "execute");
    if (!tools.some((tool) => tool.name === toolName)) {
      throw new ProviderRequestError(403, "The selected Tongdaxin tool is not available as read-only");
    }
    const result = await withTongdaxinClient(context, "execute", (client) =>
      client.callTool(
        { name: toolName, arguments: argumentsValue },
        { timeout: requestTimeoutMs, signal: context.signal },
      ),
    );
    if (!("toolResult" in result) && result.isError) {
      throw new ProviderRequestError(502, `Tongdaxin MCP tool ${toolName} returned an error`, result);
    }
    if ("toolResult" in result || result.structuredContent) {
      return { result: "toolResult" in result ? result : result.structuredContent };
    }
    const text = result.content.find((item) => item.type === "text");
    return { result: text?.type === "text" ? text.text : result.content };
  },
};

export const executors: ProviderExecutors = defineApiKeyProviderExecutors(service, handlers, {
  skipDnsValidation: true,
});

export const credentialValidators: CredentialValidators = {
  async apiKey(input, { fetcher, signal }) {
    const context = { apiKey: input.apiKey, fetcher, signal };
    const tools = await discoverSupportedTools(context, "validate");
    if (tools.length === 0) {
      throw new ProviderRequestError(400, "Tongdaxin MCP did not expose any supported read-only tools");
    }
    const hash = createHash("sha256").update(input.apiKey).digest("hex").slice(0, 16);
    return {
      profile: {
        accountId: `tongdaxin:mcp:${hash}`,
        displayName: `Tongdaxin · ${hash.slice(-6)}`,
      },
      grantedScopes: [],
      metadata: { mcpEndpoint: endpoint.toString(), discoveredToolCount: tools.length },
    };
  },
};

async function discoverSupportedTools(
  context: ApiKeyProviderContext,
  phase: "validate" | "execute",
): Promise<TongdaxinTool[]> {
  const result = await withTongdaxinClient(context, phase, (client) =>
    client.listTools({}, { timeout: requestTimeoutMs, signal: context.signal }),
  );
  return result.tools
    .filter(
      (tool) =>
        supportedToolNames.has(tool.name) &&
        tool.annotations?.readOnlyHint === true &&
        tool.annotations.destructiveHint !== true,
    )
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      annotations: tool.annotations,
      inputSchema: tool.inputSchema,
    }));
}

async function withTongdaxinClient<T>(
  context: ApiKeyProviderContext,
  phase: "validate" | "execute",
  run: (client: Client) => Promise<T>,
): Promise<T> {
  return withMcpClient(
    {
      endpoint,
      transport: "streamable_http",
      fetcher: context.fetcher,
      headers: {
        authorization: `Bearer ${context.apiKey}`,
        "user-agent": providerUserAgent,
      },
      redirect: "error",
      signal: context.signal,
      mapError: (error) => mapTongdaxinError(error, phase),
    },
    run,
  );
}

function mapTongdaxinError(error: unknown, phase: "validate" | "execute"): unknown {
  if (error instanceof ProviderRequestError) return error;
  if (error instanceof UnauthorizedError) {
    return new ProviderRequestError(phase === "validate" ? 400 : 401, "Tongdaxin API Key is invalid or expired");
  }
  if (error instanceof SdkHttpError) {
    if (error.status === 401) {
      return new ProviderRequestError(phase === "validate" ? 400 : 401, "Tongdaxin API Key is invalid or expired");
    }
    const status = 400 <= error.status && error.status < 500 ? error.status : 502;
    return new ProviderRequestError(status, `Tongdaxin MCP request failed: ${error.message}`, error);
  }
  if (error instanceof ProtocolError) {
    return new ProviderRequestError(502, `Tongdaxin MCP request failed: ${error.message}`, error);
  }
  return new ProviderRequestError(
    502,
    error instanceof Error ? `Tongdaxin MCP request failed: ${error.message}` : "Tongdaxin MCP request failed",
    error,
  );
}
