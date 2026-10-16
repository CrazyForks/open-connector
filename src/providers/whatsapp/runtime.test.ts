import type { WhatsAppActionContext } from "./runtime.ts";

import { describe, expect, it } from "vitest";
import { whatsappActionHandlers } from "./runtime.ts";

function createContext(respond: (url: URL) => unknown): WhatsAppActionContext {
  return {
    accessToken: "token",
    wabaId: "123456789",
    fetcher: async (input) => Response.json(respond(new URL(input.toString()))),
  };
}

describe("WhatsApp paging", () => {
  it("spells the final page out as hasMore: false even when a cursor is still present", async () => {
    const context = createContext((url) =>
      url.searchParams.get("after") === null
        ? {
            data: [{ id: "1" }],
            paging: { cursors: { before: "b1", after: "a1" }, next: "https://graph.facebook.com/next?after=a1" },
          }
        : { data: [{ id: "2" }], paging: { cursors: { before: "b2", after: "a2" } } },
    );
    const first = (await whatsappActionHandlers.get_phone_numbers({}, context)) as {
      paging: { hasMore: boolean; next?: string };
    };
    expect(first.paging.hasMore).toBe(true);
    expect(first.paging.next).toBe("https://graph.facebook.com/next?after=a1");

    const last = (await whatsappActionHandlers.get_phone_numbers({ after: "a1" }, context)) as {
      paging: { hasMore: boolean; next?: string; cursors: { after: string } };
    };
    expect(last.paging.hasMore).toBe(false);
    expect(last.paging.next).toBeUndefined();
    expect(last.paging.cursors.after).toBe("a2");
  });

  it("omits paging entirely when Meta sends none", async () => {
    const context = createContext(() => ({ data: [] }));
    const result = (await whatsappActionHandlers.get_phone_numbers({}, context)) as { paging?: unknown };
    expect(result.paging).toBeUndefined();
  });
});
