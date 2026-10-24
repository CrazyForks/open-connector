import type { ExecutionContext } from "../../core/types.ts";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executors, gmailActionHandlers } from "./executors.ts";

beforeEach(() => {
  vi.useFakeTimers();
  // Pin the jitter to its upper bound so backoff waits are deterministic.
  vi.spyOn(Math, "random").mockReturnValue(0.999_999);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const credentialContext: ExecutionContext = {
  getCredential: async () => ({
    authType: "oauth2",
    accessToken: "secret-token",
    tokenType: "Bearer",
    metadata: {},
    profile: { accountId: "me", displayName: "Test", grantedScopes: [] },
  }),
};

type GetResponder = (messageId: string, attempt: number) => Response | undefined;

interface MailboxStub {
  fetcher: typeof fetch;
  getCalls: string[];
  maxInFlight: () => number;
  inFlightAt: number[];
}

/**
 * Serve one `messages.list` page of `count` ids, then `messages.get` for each id. `respond` may
 * return an error response for a given message and attempt; otherwise the message is served.
 * Each get resolves after 10 ms of (fake) time so concurrent calls overlap observably.
 */
function stubMailbox(count: number, respond: GetResponder = () => undefined): MailboxStub {
  const ids = Array.from({ length: count }, (_value, index) => `m${index}`);
  const attempts = new Map<string, number>();
  const getCalls: string[] = [];
  const inFlightAt: number[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages")) {
      return Response.json({
        messages: ids.map((id) => ({ id, threadId: `t-${id}` })),
        nextPageToken: "next-page",
        resultSizeEstimate: count,
      });
    }
    const messageId = url.pathname.split("/").at(-1)!;
    const attempt = (attempts.get(messageId) ?? 0) + 1;
    attempts.set(messageId, attempt);
    getCalls.push(messageId);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    inFlightAt.push(inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return (
        respond(messageId, attempt) ??
        Response.json({
          id: messageId,
          threadId: `t-${messageId}`,
          snippet: `snippet ${messageId}`,
          payload: { headers: [{ name: "Subject", value: `Subject ${messageId}` }] },
        })
      );
    } finally {
      inFlight -= 1;
    }
  }) as typeof fetch;
  return { fetcher, getCalls, maxInFlight: () => maxInFlight, inFlightAt };
}

function rateLimited(status: 403 | 429, reason: string, retryAfterSeconds?: number) {
  return Response.json(
    { error: { code: status, message: "User-rate limit exceeded.", errors: [{ reason }] } },
    { status, headers: retryAfterSeconds === undefined ? undefined : { "Retry-After": String(retryAfterSeconds) } },
  );
}

function actionContext(fetcher: typeof fetch) {
  return { userId: "me", accessToken: "gmail-token", fetcher };
}

/** Start the action and drain fake time until it settles. */
async function settle<T>(promise: Promise<T>) {
  const outcome = promise.then(
    (value) => ({ value, error: undefined }),
    (error: unknown) => ({ value: undefined, error }),
  );
  await vi.runAllTimersAsync();
  return outcome;
}

describe("Gmail fetch_emails hydration under per-user rate limits", () => {
  it.each([
    { status: 429 as const, reason: "rateLimitExceeded" },
    { status: 403 as const, reason: "userRateLimitExceeded" },
    { status: 403 as const, reason: "rateLimitExceeded" },
  ])("retries messages limited once with $status / $reason and returns the full page", async ({ status, reason }) => {
    const limitedOnce = new Set(["m2", "m5", "m11"]);
    const mailbox = stubMailbox(25, (id, attempt) =>
      limitedOnce.has(id) && attempt === 1 ? rateLimited(status, reason) : undefined,
    );

    const { value, error } = await settle(
      gmailActionHandlers.fetch_emails({ maxResults: 25 }, actionContext(mailbox.fetcher)),
    );

    expect(error).toBeUndefined();
    const page = value as { messages: Array<{ messageId: string; subject: string }>; nextPageToken: string };
    expect(page.messages.map((message) => message.messageId)).toEqual(
      Array.from({ length: 25 }, (_value, index) => `m${index}`),
    );
    expect(page.messages.find((message) => message.messageId === "m5")?.subject).toBe("Subject m5");
    expect(page.nextPageToken).toBe("next-page");
    // Every message is fetched once, plus exactly one retry for each limited message.
    expect(mailbox.getCalls).toHaveLength(25 + limitedOnce.size);
    for (const id of limitedOnce) {
      expect(mailbox.getCalls.filter((call) => call === id)).toHaveLength(2);
    }
  });

  it.each([
    { status: 429 as const, reason: "rateLimitExceeded" },
    { status: 403 as const, reason: "userRateLimitExceeded" },
    { status: 403 as const, reason: "rateLimitExceeded" },
  ])("waits the upstream Retry-After before retrying ($status / $reason)", async ({ status, reason }) => {
    const mailbox = stubMailbox(3, (id, attempt) =>
      id === "m1" && attempt === 1 ? rateLimited(status, reason, 7) : undefined,
    );
    const pending = gmailActionHandlers.fetch_emails({}, actionContext(mailbox.fetcher));
    let settled = false;
    void pending.then(() => (settled = true));

    // The first batch completes at 10 ms; m1 must not be retried before 7 s have passed.
    await vi.advanceTimersByTimeAsync(10 + 7_000 - 1);
    expect(mailbox.getCalls.filter((call) => call === "m1")).toHaveLength(1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(mailbox.getCalls.filter((call) => call === "m1")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10);
    await expect(pending).resolves.toMatchObject({
      messages: [{ messageId: "m0" }, { messageId: "m1" }, { messageId: "m2" }],
    });
  });

  it.each([
    { status: 429 as const, reason: "rateLimitExceeded" },
    { status: 403 as const, reason: "userRateLimitExceeded" },
    { status: 403 as const, reason: "rateLimitExceeded" },
  ])(
    "fails as rate_limited with no partial page when the limit persists ($status / $reason)",
    async ({ status, reason }) => {
      const mailbox = stubMailbox(12, (id) => (id === "m4" ? rateLimited(status, reason, 3) : undefined));
      vi.stubGlobal("fetch", mailbox.fetcher);

      const { value: result } = await settle(executors["gmail.fetch_emails"]!({}, credentialContext));

      expect(result).toMatchObject({
        ok: false,
        error: { code: "rate_limited", details: { status, details: { retryAfterSeconds: 3 } } },
      });
      expect(result).not.toHaveProperty("output");
      // The attempt cap stops the retries: six tries for the limited message, one for each other.
      expect(mailbox.getCalls.filter((call) => call === "m4")).toHaveLength(6);
      expect(mailbox.getCalls).toHaveLength(11 + 6);
    },
  );

  it.each([
    { status: 429 as const, reason: "rateLimitExceeded" },
    { status: 403 as const, reason: "userRateLimitExceeded" },
    { status: 403 as const, reason: "rateLimitExceeded" },
  ])(
    "stops retrying once the next wait would overrun the action's retry budget ($status / $reason)",
    async ({ status, reason }) => {
      const mailbox = stubMailbox(2, (id) => (id === "m0" ? rateLimited(status, reason, 600) : undefined));

      const { value, error } = await settle(gmailActionHandlers.fetch_emails({}, actionContext(mailbox.fetcher)));

      expect(value).toBeUndefined();
      expect(error).toMatchObject({ status, details: { retryAfterSeconds: 600 } });
      expect(mailbox.getCalls.filter((call) => call === "m0")).toHaveLength(1);
    },
  );

  it.each([
    { name: "a server error", response: () => Response.json({ error: { message: "Backend" } }, { status: 500 }) },
    { name: "a daily quota", response: () => rateLimited(403, "dailyLimitExceeded") },
    { name: "a project quota", response: () => rateLimited(403, "quotaExceeded") },
    { name: "a missing message", response: () => Response.json({ error: { message: "Not Found" } }, { status: 404 }) },
  ])("fails immediately on $name without retrying", async ({ response }) => {
    const mailbox = stubMailbox(15, (id) => (id === "m3" ? response() : undefined));

    const { value, error } = await settle(gmailActionHandlers.fetch_emails({}, actionContext(mailbox.fetcher)));

    expect(value).toBeUndefined();
    expect(error).toBeDefined();
    // The failing message is not retried and the second batch never starts.
    expect(mailbox.getCalls.filter((call) => call === "m3")).toHaveLength(1);
    expect(mailbox.getCalls).toHaveLength(10);
  });

  it("narrows concurrency after a rate limit and widens it slowly after clean batches", async () => {
    const mailbox = stubMailbox(40, (id, attempt) =>
      id === "m0" && attempt === 1 ? rateLimited(429, "rateLimitExceeded") : undefined,
    );

    const { error } = await settle(
      gmailActionHandlers.fetch_emails({ maxResults: 40 }, actionContext(mailbox.fetcher)),
    );

    expect(error).toBeUndefined();
    expect(mailbox.maxInFlight()).toBe(10);
    // First batch: 10 in flight. After the 429 the width halves to 5, then grows by one per clean batch until the 5 left.
    const batchWidths: number[] = [];
    for (const depth of mailbox.inFlightAt) {
      if (depth === 1) batchWidths.push(1);
      else batchWidths[batchWidths.length - 1] = depth;
    }
    expect(batchWidths).toEqual([10, 5, 6, 7, 8, 5]);
    expect(mailbox.getCalls).toHaveLength(41);
  });
});
