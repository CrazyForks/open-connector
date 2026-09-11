import type { ProviderActionDefinition } from "../../core/provider-definition.ts";

import { defineProviderAction } from "../../core/provider-definition.ts";
import { xydcMcpToolDefinitions } from "./official-tools.ts";

export const xydcMcpOfficialActions: ProviderActionDefinition[] = xydcMcpToolDefinitions.map((tool) =>
  defineProviderAction("xydc_mcp", {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    followUpActions: tool.followUpActions.map((item) => item.actionId),
  }),
);
