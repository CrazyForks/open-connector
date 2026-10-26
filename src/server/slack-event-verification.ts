import { verifySlackSignature } from "../triggers/sources/slack-signature.ts";
import { eventRequestMaximumBodyBytes } from "./event-request-body.ts";

export interface SlackEventVerificationInput {
  /** Value of the X-Slack-Request-Timestamp header. */
  timestamp: string;
  /** Value of the X-Slack-Signature header. */
  signature: string;
  /** Raw request body bytes; they must not be re-serialized. */
  rawBody: Uint8Array;
  /** App ID of the Slack application configured in this runtime. */
  configuredAppId: string;
  /** Signing secret of the Slack application configured in this runtime. */
  signingSecret: string;
  /** Request Content-Type. Form-urlencoded Slack interactions are verified without parsing. */
  contentType?: string;
  /** Current time in milliseconds; injectable for tests. */
  now?: number;
}

export type SlackEventVerificationResult =
  | { valid: true; appId: string; challenge: string | null }
  | {
      valid: false;
      reason: "signature" | "timestamp" | "payload" | "app" | "body_too_large";
    };

/**
 * Verifies the signature, timestamp window, and App ID of an inbound Slack request.
 *
 * Verification only: this function does not persist, deduplicate, or schedule events.
 */
export async function verifySlackEventRequest(
  input: SlackEventVerificationInput,
): Promise<SlackEventVerificationResult> {
  const now = input.now ?? Date.now();
  if (input.rawBody.byteLength > eventRequestMaximumBodyBytes) {
    return { valid: false, reason: "body_too_large" };
  }
  const reason = await verifySlackSignature({ ...input, now });
  if (reason) return { valid: false, reason };

  // Slack interaction callbacks are form-urlencoded and do not contain api_app_id.
  // The app-scoped signing secret already proves which application sent the request.
  if (contentType(input.contentType) === "application/x-www-form-urlencoded") {
    return { valid: true, appId: input.configuredAppId, challenge: null };
  }

  // Only parse the body after its signature is trusted.
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.rawBody));
  } catch {
    return { valid: false, reason: "payload" };
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { valid: false, reason: "payload" };
  }
  const record = payload as Record<string, unknown>;
  const isChallenge = record.type === "url_verification";
  if (!isChallenge && record.type !== "event_callback") return { valid: false, reason: "payload" };
  if ((!isChallenge || record.api_app_id !== undefined) && record.api_app_id !== input.configuredAppId)
    return { valid: false, reason: "app" };
  if (isChallenge && (typeof record.challenge !== "string" || !record.challenge || record.challenge.length > 1024))
    return { valid: false, reason: "payload" };
  return {
    valid: true,
    appId: input.configuredAppId,
    challenge: isChallenge ? (record.challenge as string) : null,
  };
}

function contentType(value: string | undefined): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}
