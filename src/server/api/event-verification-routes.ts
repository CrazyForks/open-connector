import type { ConnectionService } from "../../connection-service.ts";
import type { Context } from "hono";

import { Hono } from "hono";
import { ConnectionError } from "../../connection-error.ts";
import { optionalString } from "../../core/cast.ts";
import { readEventRequestBody } from "../event-request-body.ts";
import { BotFrameworkKeysUnavailableError, verifyTeamsBotEventRequest } from "../teams-bot-event-verification.ts";
import { readConnectionName } from "./http-utils.ts";
import { mapConnectionErrorStatus, writeRuntimeFailure, writeRuntimeSuccess } from "./runtime-api.ts";

const teamsBotService = "microsoft_teams_bot";
// Authorization carries the dedicated verify token, so the activity's own bearer token is forwarded here.
const botFrameworkAuthorizationHeader = "x-botframework-authorization";

export interface TeamsBotEventVerificationRoutesOptions {
  connections: ConnectionService;
  /** Dedicated OOMOL_CONNECT_EVENT_VERIFY_TOKEN, when configured. */
  eventVerifyToken: string | undefined;
}

/**
 * Checks the dedicated event verification bearer token. Returns the failure
 * response when the route must not proceed, or undefined when it is authorized.
 */
export async function rejectUnauthorizedEventVerification(
  context: Context,
  eventVerifyToken: string | undefined,
): Promise<Response | undefined> {
  const expected = eventVerifyToken?.trim();
  if (!expected)
    return writeRuntimeFailure(context, {
      status: 404,
      errorCode: "event_verification_disabled",
      message: "Event verification is disabled.",
    });
  const authorization = context.req.header("authorization") ?? "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!(await sameSecret(provided, expected)))
    return writeRuntimeFailure(context, {
      status: 401,
      errorCode: "unauthorized",
      message: "A valid event verification token is required.",
    });
  return undefined;
}

/**
 * Inbound Microsoft Teams bot activity verification. The bot is the connection
 * selected the same way Actions select one, so a deployment can hold several bots.
 */
export function createTeamsBotEventVerificationRoutes({
  connections,
  eventVerifyToken,
}: TeamsBotEventVerificationRoutesOptions): Hono {
  const app = new Hono();

  app.post(`/providers/${teamsBotService}/events/verify`, async (context) => {
    const rejected = await rejectUnauthorizedEventVerification(context, eventVerifyToken);
    if (rejected) return rejected;

    let appId: string | undefined;
    try {
      const connection = await connections.resolveConnection(
        teamsBotService,
        readConnectionName(context),
        optionalString(context.req.header("x-oo-connector-app-id")),
      );
      if (connection.source === "local" && connection.credential?.authType === "custom_credential")
        appId = optionalString(connection.credential.values.appId);
    } catch (error) {
      if (error instanceof ConnectionError)
        return writeRuntimeFailure(context, {
          status: mapConnectionErrorStatus(error),
          errorCode: error.code,
          message: error.message,
        });
      throw error;
    }
    if (!appId)
      return writeRuntimeFailure(context, {
        status: 409,
        errorCode: "event_verification_not_configured",
        message: "Connect a Microsoft Teams Bot account with its Application (client) ID first.",
      });

    const rawBody = await readEventRequestBody(context.req.raw);
    if (!rawBody)
      return writeRuntimeFailure(context, {
        status: 413,
        errorCode: "webhook_request_too_large",
        message: "Teams request body exceeds 64 KiB.",
      });

    let result: Awaited<ReturnType<typeof verifyTeamsBotEventRequest>>;
    try {
      result = await verifyTeamsBotEventRequest({
        authorization: context.req.header(botFrameworkAuthorizationHeader) ?? "",
        rawBody,
        appId,
      });
    } catch (error) {
      if (!(error instanceof BotFrameworkKeysUnavailableError)) throw error;
      return writeRuntimeFailure(context, {
        status: 502,
        errorCode: "event_verification_unavailable",
        message: "Bot Framework signing keys are unavailable.",
      });
    }
    if (result.valid) return writeRuntimeSuccess(context, result);
    switch (result.reason) {
      case "body_too_large":
        return writeRuntimeFailure(context, {
          status: 413,
          errorCode: "webhook_request_too_large",
          message: "Teams request body exceeds 64 KiB.",
        });
      case "payload":
        return writeRuntimeFailure(context, {
          status: 400,
          errorCode: "invalid_event_payload",
          message: "Invalid Teams activity.",
        });
      case "app":
        return writeRuntimeFailure(context, {
          status: 403,
          errorCode: "webhook_app_mismatch",
          message: "The token audience does not match the selected bot.",
        });
      case "timestamp":
        return writeRuntimeFailure(context, {
          status: 401,
          errorCode: "invalid_webhook_timestamp",
          message: "The Bot Framework token is expired or not yet valid.",
        });
      case "token":
      case "service_url":
      case "channel":
        return writeRuntimeFailure(context, {
          status: 401,
          errorCode: "invalid_webhook_signature",
          message: "Invalid Bot Framework token.",
        });
    }
  });

  return app;
}

/** Hash both values before a constant-time comparison so length never leaks. */
async function sameSecret(provided: string, expected: string): Promise<boolean> {
  if (!provided || !expected) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index]! ^ b[index]!;
  return difference === 0;
}
