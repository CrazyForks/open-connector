import type { JsonValue } from "../triggers/common/types.ts";

import { optionalString } from "../core/cast.ts";
import { isJsonObject } from "../triggers/common/json.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const signatureMaximumSkewSeconds = 300;

export interface FeishuEventVerificationInput {
  /** Raw Feishu request body; signatures must use these exact bytes. */
  rawBody: Uint8Array;
  /** X-Lark-Request-Timestamp header. */
  timestamp: string;
  /** X-Lark-Request-Nonce header. */
  nonce: string;
  /** X-Lark-Signature header. */
  signature: string;
  /** Feishu app_id stored on the selected feishu_app_bot connection. */
  appId: string;
  /** Feishu Verification Token stored on the selected connection. */
  verificationToken: string;
  /** Feishu Encrypt Key stored on the selected connection. */
  encryptKey: string;
  /** Current Unix time in seconds. */
  nowEpochSeconds: number;
}

export type FeishuEventVerificationResult =
  | {
      valid: true;
      appId: string;
      tenantKey: string;
      challenge?: string;
      payload?: Record<string, JsonValue>;
      signatureVerified: boolean;
    }
  | {
      valid: false;
      reason: "payload" | "token" | "app" | "timestamp" | "signature";
    };

/**
 * Verifies and decrypts one Feishu event request using credentials held by a
 * feishu_app_bot connection. The returned payload is the trusted, decrypted
 * Feishu envelope and can be parsed without exposing app credentials to callers.
 */
export async function verifyFeishuEventRequest(
  input: FeishuEventVerificationInput,
): Promise<FeishuEventVerificationResult> {
  let envelope: Record<string, JsonValue>;
  try {
    const parsed: unknown = JSON.parse(decoder.decode(input.rawBody));
    if (!isJsonObject(parsed)) return { valid: false, reason: "payload" };
    envelope = parsed;
  } catch {
    return { valid: false, reason: "payload" };
  }

  const decrypted = await decryptIfNeeded(envelope, input.encryptKey);
  if (!decrypted) return { valid: false, reason: "payload" };

  const signature = await verifySignatureIfPresent(input.rawBody, input, input.encryptKey);
  if (signature === "timestamp" || signature === "signature") return { valid: false, reason: signature };

  const type = optionalString(decrypted.type);
  if (type === "url_verification") {
    if (!sameSecret(optionalString(decrypted.token) ?? "", input.verificationToken))
      return { valid: false, reason: "token" };
    const challenge = optionalString(decrypted.challenge);
    if (!challenge || challenge.length > 1024) return { valid: false, reason: "payload" };
    return {
      valid: true,
      appId: input.appId,
      tenantKey: "",
      challenge,
      signatureVerified: signature === "verified",
    };
  }

  if (signature !== "verified") return { valid: false, reason: "signature" };
  if (decrypted.schema != "2.0") return { valid: false, reason: "payload" };
  const header = isJsonObject(decrypted.header) ? decrypted.header : undefined;
  if (!header || !sameSecret(optionalString(header.token) ?? "", input.verificationToken))
    return { valid: false, reason: "token" };
  const appId = optionalString(header.app_id) ?? optionalString(decrypted.app_id) ?? "";
  if (!sameSecret(appId, input.appId)) return { valid: false, reason: "app" };
  const tenantKey = optionalString(header.tenant_key) ?? "";
  if (!tenantKey || tenantKey.length > 256) return { valid: false, reason: "payload" };
  const eventType = optionalString(header.event_type);
  const eventId = optionalString(header.event_id);
  if (!eventType || !eventId || !isJsonObject(decrypted.event)) return { valid: false, reason: "payload" };

  const { token: _token, header: _header, ...payload } = decrypted;
  const { token: _headerToken, ...safeHeader } = header;
  return {
    valid: true,
    appId,
    tenantKey,
    payload: { ...payload, header: safeHeader },
    signatureVerified: signature === "verified",
  };
}

async function decryptIfNeeded(
  envelope: Record<string, JsonValue>,
  encryptKey: string,
): Promise<Record<string, JsonValue> | undefined> {
  const encrypted = optionalString(envelope.encrypt);
  if (!encrypted) return envelope;
  if (!encryptKey || !/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted)) return undefined;
  try {
    const bytes = Uint8Array.from(atob(encrypted), (character) => character.charCodeAt(0));
    if (bytes.length < 32 || bytes.length % 16 !== 0) return undefined;
    const key = await crypto.subtle.importKey(
      "raw",
      await crypto.subtle.digest("SHA-256", encoder.encode(encryptKey)),
      "AES-CBC",
      false,
      ["decrypt"],
    );
    const plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv: bytes.slice(0, 16) }, key, bytes.slice(16));
    const parsed: unknown = JSON.parse(decoder.decode(plain));
    return isJsonObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function verifySignatureIfPresent(
  rawBody: Uint8Array,
  input: FeishuEventVerificationInput,
  encryptKey: string,
): Promise<"absent" | "verified" | "timestamp" | "signature"> {
  const values = [input.timestamp, input.nonce, input.signature];
  if (values.every((value) => value.trim() === "")) return "absent";
  if (values.some((value) => value.trim() === "")) return "signature";
  if (!/^\d{10,13}$/.test(input.timestamp)) return "timestamp";
  const timestampSeconds = input.timestamp.length >= 13 ? Number(input.timestamp) / 1000 : Number(input.timestamp);
  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(input.nowEpochSeconds - timestampSeconds) > signatureMaximumSkewSeconds
  )
    return "timestamp";
  const prefix = encoder.encode(input.timestamp + input.nonce + encryptKey);
  const signed = new Uint8Array(prefix.length + rawBody.length);
  signed.set(prefix);
  signed.set(rawBody, prefix.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", signed));
  const expected = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return sameSecret(input.signature, expected) ? "verified" : "signature";
}

function sameSecret(provided: string, expected: string): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1)
    difference |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}
