import { describe, expect, it, vi } from "vitest";
import { microsoftGraphRequest } from "./microsoft-graph.ts";

describe("Microsoft Graph URL validation", () => {
  it("applies the pagination allowlist to root-relative URLs", async () => {
    const fetcher = vi.fn(async () => Response.json({}));

    await expect(
      microsoftGraphRequest("/v1.0/me/messages", {
        accessToken: "access-token",
        fetcher,
        label: "Microsoft Graph test",
        allowNextLink: (pathname) => pathname === "/v1.0/me/mailFolders",
      }),
    ).rejects.toThrow("nextLink does not target an allowed Microsoft Graph endpoint");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
