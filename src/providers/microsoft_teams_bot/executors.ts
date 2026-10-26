import type { CredentialValidators, ExecutionContext, ProviderExecutors } from "../../core/types.ts";
import type { TeamsBotContext } from "./runtime.ts";

import { requireCustomCredential } from "../provider-credentials.ts";
import { defineProviderExecutors } from "../provider-executors.ts";
import { createProviderFetch } from "../provider-runtime.ts";
import { microsoftTeamsBotActionHandlers, readTeamsBotCredential, validateTeamsBotCredential } from "./runtime.ts";

const service = "microsoft_teams_bot";

export const executors: ProviderExecutors = defineProviderExecutors<TeamsBotContext>({
  service,
  handlers: microsoftTeamsBotActionHandlers,
  async createContext(context: ExecutionContext, fetcher: typeof fetch): Promise<TeamsBotContext> {
    const credential = await requireCustomCredential(context, service);
    return { ...readTeamsBotCredential(credential.values), fetcher, signal: context.signal };
  },
});

export const credentialValidators: CredentialValidators = {
  customCredential(input, { fetcher, signal }) {
    return validateTeamsBotCredential(input.values, createProviderFetch({ fetch: fetcher }), signal);
  },
};
