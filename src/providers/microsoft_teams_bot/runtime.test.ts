import { describe, expect, it } from "vitest";
import { microsoftTeamsBotActionHandlers, normalizeServiceUrl, validateTeamsBotCredential } from "./runtime.ts";

const values = { appId: "app-1", clientSecret: "secret-1", tenantId: "tenant-1" };

function tokenResponse(): Response {
  return Response.json({ access_token: "token-1", expires_in: 3600 });
}

describe("normalizeServiceUrl", () => {
  it("accepts Bot Connector hosts and trims the trailing slash", () => {
    expect(normalizeServiceUrl("https://smba.trafficmanager.net/amer/?x=1")).toBe(
      "https://smba.trafficmanager.net/amer",
    );
  });

  it("rejects hosts that would receive the bot token", () => {
    expect(normalizeServiceUrl("https://smba.infra.gov.teams.microsoft.us/teams/")).toBe(
      "https://smba.infra.gov.teams.microsoft.us/teams",
    );
    expect(() => normalizeServiceUrl("https://attacker.example/v3")).toThrow("Bot Connector host");
    expect(() => normalizeServiceUrl("https://smba.trafficmanager.net.attacker.example/")).toThrow(
      "Bot Connector host",
    );
    expect(() => normalizeServiceUrl("http://smba.trafficmanager.net/")).toThrow("https");
    expect(() => normalizeServiceUrl("https://user:pw@smba.trafficmanager.net/")).toThrow("without credentials");
  });
});

describe("validateTeamsBotCredential", () => {
  it("returns the app id as the account identity", async () => {
    const result = await validateTeamsBotCredential(values, async () => tokenResponse());
    expect(result.profile?.accountId).toBe("app-1");
  });

  it("contacts Microsoft even when a token for the same secret is cached", async () => {
    let calls = 0;
    const fetcher = async (): Promise<Response> => {
      calls += 1;
      return tokenResponse();
    };
    await validateTeamsBotCredential({ ...values, appId: "app-cache" }, fetcher);
    await validateTeamsBotCredential({ ...values, appId: "app-cache" }, fetcher);
    expect(calls).toBe(2);
  });

  it("reports a rejected secret as a field error", async () => {
    const rejected = async (): Promise<Response> =>
      Response.json(
        { error: "invalid_client", error_description: "AADSTS7000215: bad secret\r\nTrace ID: x" },
        { status: 401 },
      );
    await expect(validateTeamsBotCredential({ ...values, appId: "app-2" }, rejected)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("AADSTS7000215: bad secret"),
    });
  });
});

describe("microsoft_teams_bot actions", () => {
  it("maps a rejected token to an execute-phase 401", async () => {
    const context = {
      ...values,
      appId: "app-3",
      fetcher: async (): Promise<Response> => Response.json({ error: "invalid_client" }, { status: 401 }),
    };
    await expect(
      microsoftTeamsBotActionHandlers.send_message(
        { serviceUrl: "https://smba.trafficmanager.net/teams/", conversationId: "c", text: "hi" },
        context,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("posts the activity to the encoded conversation path with the bearer token", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const context = {
      ...values,
      appId: "app-4",
      fetcher: async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        calls.push({ url: String(url), init });
        return String(url).includes("login.microsoftonline.com") ? tokenResponse() : Response.json({ id: "a1" });
      },
    };
    const output = await microsoftTeamsBotActionHandlers.send_message(
      {
        serviceUrl: "https://smba.trafficmanager.net/teams/",
        conversationId: "19:x@thread.tacv2;messageid=1",
        text: "hi",
      },
      context,
    );
    expect(output).toEqual({ id: "a1" });
    expect(calls[1]?.url).toBe(
      "https://smba.trafficmanager.net/teams/v3/conversations/19%3Ax%40thread.tacv2%3Bmessageid%3D1/activities",
    );
    expect(new Headers(calls[1]?.init?.headers).get("authorization")).toBe("Bearer token-1");
  });

  it("starts a team thread with the tenant in both documented placements", async () => {
    const bodies: unknown[] = [];
    const context = {
      ...values,
      appId: "app-5",
      fetcher: async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        if (String(url).includes("login.microsoftonline.com")) return tokenResponse();
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({ id: "conv-1", activityId: "a1" });
      },
    };
    const output = await microsoftTeamsBotActionHandlers.create_conversation(
      { serviceUrl: "https://smba.trafficmanager.net/teams/", teamId: "team-1", text: "hi" },
      context,
    );
    expect(output).toMatchObject({ id: "conv-1", activityId: "a1" });
    expect(bodies[0]).toMatchObject({
      isGroup: true,
      bot: { id: "28:app-5" },
      tenantId: "tenant-1",
      channelData: { channel: { id: "team-1" }, tenant: { id: "tenant-1" } },
      activity: { type: "message", text: "hi" },
    });
    await expect(
      microsoftTeamsBotActionHandlers.create_conversation(
        { serviceUrl: "https://smba.trafficmanager.net/teams/", text: "hi" },
        context,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("routes a thread through the root message id and mints a sovereign token for government hosts", async () => {
    const calls: string[] = [];
    const context = {
      ...values,
      appId: "app-6",
      fetcher: async (url: string | URL | Request): Promise<Response> => {
        calls.push(String(url));
        return String(url).includes("login.microsoftonline")
          ? tokenResponse()
          : Response.json({ members: [], continuationToken: "t" });
      },
    };
    await microsoftTeamsBotActionHandlers.send_message(
      {
        serviceUrl: "https://smba.infra.gov.teams.microsoft.us/teams/",
        conversationId: "19:x@thread.tacv2;messageid=9",
        threadId: "123",
        text: "hi",
      },
      context,
    );
    expect(calls[0]).toBe("https://login.microsoftonline.us/tenant-1/oauth2/v2.0/token");
    expect(calls[1]).toContain("19%3Ax%40thread.tacv2%3Bmessageid%3D123/activities");
    const page = await microsoftTeamsBotActionHandlers.list_conversation_members(
      {
        serviceUrl: "https://smba.trafficmanager.net/teams/",
        conversationId: "c1",
        pageSize: 50,
        continuationToken: "abc",
      },
      context,
    );
    expect(page).toEqual({ members: [], continuationToken: "t" });
    expect(calls.at(-1)).toBe(
      "https://smba.trafficmanager.net/teams/v3/conversations/c1/pagedMembers?pageSize=50&continuationToken=abc",
    );
    await expect(
      microsoftTeamsBotActionHandlers.send_message(
        { serviceUrl: "https://smba.trafficmanager.net/teams/", conversationId: "c1", threadId: "0", text: "hi" },
        context,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
