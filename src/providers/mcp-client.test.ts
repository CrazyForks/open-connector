import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withMcpClient } from "./mcp-client.ts";

const lifecycle = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn(),
  terminateSession: vi.fn(),
}));

vi.mock("@modelcontextprotocol/client", () => ({
  Client: class {
    connect = lifecycle.connect;
    close = lifecycle.close;
  },
  StreamableHTTPClientTransport: class {
    terminateSession = lifecycle.terminateSession;
  },
  SSEClientTransport: class {},
}));

beforeEach(() => {
  lifecycle.connect.mockReset().mockResolvedValue(undefined);
  lifecycle.close.mockReset().mockResolvedValue(undefined);
  lifecycle.terminateSession.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

it.each([undefined, false])("preserves the server session when terminateSession is %s", async (terminateSession) => {
  const result = await withMcpClient(
    { endpoint: new URL("https://example.com/mcp"), transport: "streamable_http", terminateSession },
    async () => "query-handle",
  );
  expect(result).toBe("query-handle");
  expect(lifecycle.terminateSession).not.toHaveBeenCalled();
  expect(lifecycle.close).toHaveBeenCalledOnce();
});

it("does not terminate a running action after the cleanup timeout", async () => {
  vi.useFakeTimers();
  const run = vi.fn(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 5_000));
    return "finished";
  });
  const result = withMcpClient(
    { endpoint: new URL("https://example.com/mcp"), transport: "streamable_http", terminateSession: true },
    run,
  );
  await vi.advanceTimersByTimeAsync(2_000);
  expect(lifecycle.terminateSession).not.toHaveBeenCalled();
  expect(lifecycle.close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(3_000);
  expect(await result).toBe("finished");
  expect(lifecycle.terminateSession).toHaveBeenCalledOnce();
  expect(lifecycle.close).toHaveBeenCalledOnce();
});

it("bounds session cleanup without discarding the completed action result", async () => {
  vi.useFakeTimers();
  lifecycle.terminateSession.mockImplementation(() => new Promise<void>(() => {}));
  const result = withMcpClient(
    { endpoint: new URL("https://example.com/mcp"), transport: "streamable_http", terminateSession: true },
    async () => "finished",
  );
  await vi.advanceTimersByTimeAsync(1_999);
  expect(lifecycle.close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toBe("finished");
  expect(lifecycle.close).toHaveBeenCalledOnce();
});

it("preserves the action error when session cleanup fails", async () => {
  const failure = new Error("tool failed");
  lifecycle.terminateSession.mockRejectedValue(new Error("cleanup failed"));
  const result = withMcpClient(
    { endpoint: new URL("https://example.com/mcp"), transport: "streamable_http", terminateSession: true },
    async () => {
      throw failure;
    },
  );
  await expect(result).rejects.toBe(failure);
  expect(lifecycle.close).toHaveBeenCalledOnce();
});
