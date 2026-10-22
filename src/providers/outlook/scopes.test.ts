import type { IOAuthClientConfigStore, OAuthClientConfig } from "../../oauth/oauth-client-config-service.ts";

import { describe, expect, it } from "vitest";
import { createCatalogStore } from "../../catalog-store.ts";
import { OAuthClientConfigService } from "../../oauth/oauth-client-config-service.ts";
import { outlookActions } from "./actions.ts";
import { provider } from "./definition.ts";
import { outlookOAuthScopes } from "./scopes.ts";

// The grant a read-only host holds: the identity pair every Microsoft sign-in
// carries plus the read-only permission Microsoft Graph documents for
// GET /me/mailFolders and GET /me/messages (Mail.Read). Nothing in it can write or send.
const readOnlyGrant = ["offline_access", "User.Read", "Mail.Read"];
// The actions a mail reader runs: the mailbox identity, the root folders, the messages, one message.
const readerActions = ["get_profile", "list_mail_folders", "list_messages", "get_message"];

describe("Outlook OAuth scopes", () => {
  it("lets a host request the read-only grant alone", () => {
    const service = configService();
    const config = service.normalizeConfig("outlook", {
      clientId: "client-id",
      clientSecret: "client-secret",
      requestedScopes: readOnlyGrant,
    });

    expect(config.requestedScopes).toEqual(readOnlyGrant);
    expect(service.getEffectiveScopes("outlook", config)).toEqual(readOnlyGrant);
  });

  it("still refuses a scope the definition does not declare", () => {
    expect(() =>
      configService().normalizeConfig("outlook", {
        clientId: "client-id",
        clientSecret: "client-secret",
        requestedScopes: ["Mail.ReadBasic"],
      }),
    ).toThrow("requestedScopes contains a scope not declared by outlook: Mail.ReadBasic.");
  });

  it("asks every declared scope when a host requests none", () => {
    const service = configService();
    const config = service.normalizeConfig("outlook", { clientId: "client-id", clientSecret: "client-secret" });

    expect(config.requestedScopes).toBeUndefined();
    expect(service.getEffectiveScopes("outlook", config)).toEqual(outlookOAuthScopes);
  });

  it.each(readerActions)("%s is satisfied by the read-only grant", (name) => {
    const { requiredScopes, providerPermissions } = action(name);

    expect(requiredScopes.length).toBeGreaterThan(0);
    for (const scope of [...requiredScopes, ...providerPermissions]) {
      expect(readOnlyGrant, `outlook.${name} requires ${scope}`).toContain(scope);
    }
  });
});

function action(name: string) {
  const found = outlookActions.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`outlook.${name} is not defined`);
  return found;
}

function configService(): OAuthClientConfigService {
  return new OAuthClientConfigService({
    catalog: createCatalogStore([provider]),
    origin: "http://localhost:8797",
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
