import type { IOAuthClientConfigStore, OAuthClientConfig } from "../../oauth/oauth-client-config-service.ts";

import { describe, expect, it } from "vitest";
import { createCatalogStore } from "../../catalog-store.ts";
import { OAuthClientConfigService } from "../../oauth/oauth-client-config-service.ts";
import { provider } from "./definition.ts";

const gmailComposeScope = "https://www.googleapis.com/auth/gmail.compose";
const gmailSendScope = "https://www.googleapis.com/auth/gmail.send";
const gmailSettingsSharingScope = "https://www.googleapis.com/auth/gmail.settings.sharing";
const gmailSettingsBasicScope = "https://www.googleapis.com/auth/gmail.settings.basic";
const gmailLabelsScope = "https://www.googleapis.com/auth/gmail.labels";
const gmailModifyScope = "https://www.googleapis.com/auth/gmail.modify";
const gmailReadonlyScope = "https://www.googleapis.com/auth/gmail.readonly";

describe("Gmail provider definition", () => {
  it.each([{ requestedScopes: [gmailReadonlyScope, gmailComposeScope] }, { requestedScopes: [gmailSendScope] }])(
    "accepts an explicit narrow grant $requestedScopes",
    ({ requestedScopes }) => {
      const service = configService();
      const config = service.normalizeConfig("gmail", {
        clientId: "client-id",
        clientSecret: "client-secret",
        requestedScopes,
      });

      expect(config.requestedScopes).toEqual(requestedScopes);
      expect(service.getEffectiveScopes("gmail", config)).toEqual(requestedScopes);
    },
  );

  it("does not request optional scopes when no grant is specified", () => {
    const service = configService();
    const config = service.normalizeConfig("gmail", { clientId: "client-id", clientSecret: "client-secret" });

    expect(service.getEffectiveScopes("gmail", config)).toEqual([
      gmailReadonlyScope,
      gmailModifyScope,
      gmailLabelsScope,
      gmailSettingsBasicScope,
    ]);
  });

  it("still rejects undeclared administrator-only scopes", () => {
    expect(() =>
      configService().normalizeConfig("gmail", {
        clientId: "client-id",
        clientSecret: "client-secret",
        requestedScopes: [gmailSettingsSharingScope],
      }),
    ).toThrow("requestedScopes contains a scope not declared by gmail");
  });
});

function configService(): OAuthClientConfigService {
  return new OAuthClientConfigService({
    catalog: createCatalogStore([provider]),
    origin: "http://localhost:3000",
    store: new MemoryOAuthClientConfigStore(),
  });
}

class MemoryOAuthClientConfigStore implements IOAuthClientConfigStore {
  private readonly configs = new Map<string, OAuthClientConfig>();

  async get(service: string): Promise<OAuthClientConfig | undefined> {
    return this.configs.get(service);
  }

  async set(config: OAuthClientConfig): Promise<void> {
    this.configs.set(config.service, config);
  }

  async delete(service: string): Promise<void> {
    this.configs.delete(service);
  }

  async list(): Promise<OAuthClientConfig[]> {
    return [...this.configs.values()];
  }
}
