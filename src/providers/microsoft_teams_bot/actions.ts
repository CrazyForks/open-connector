import type { ActionDefinition } from "../../core/types.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";

const service = "microsoft_teams_bot";

const serviceUrl = s.nonEmptyString(
  "Bot Connector service URL for the conversation, taken from the inbound activity the bot received. Falls back to the credential's default service URL.",
);
const conversationId = s.nonEmptyString(
  "Teams conversation ID, taken from an inbound activity or a created conversation.",
);
const activityId = s.nonEmptyString("ID of an existing activity in the conversation.");
const threadId = s.nonEmptyString(
  "Numeric ID of a channel thread's root message. Routes the call into that thread instead of the channel's main conversation.",
);
const text = s.nonEmptyString("Message text.");
const textFormat = s.stringEnum(["plain", "markdown", "xml"], {
  description: "How the text is rendered. Defaults to markdown.",
});
const resourceResponse = s.looseObject(
  { id: s.string("ID of the activity the Bot Connector created or changed.") },
  { description: "Bot Connector resource response." },
);
const channelAccount = s.object(
  {
    id: s.string("Channel-specific account ID."),
    name: s.string("Account display name."),
    aadObjectId: s.string("Microsoft Entra object ID."),
    email: s.string("Email address."),
    userPrincipalName: s.string("User principal name."),
    givenName: s.string("Given name."),
    surname: s.string("Surname."),
    tenantId: s.string("Microsoft Entra tenant ID."),
  },
  {
    additionalProperties: true,
    description: "Teams conversation member.",
    optional: ["name", "aadObjectId", "email", "userPrincipalName", "givenName", "surname", "tenantId"],
  },
);

const actions: Parameters<typeof defineProviderAction>[1][] = [
  {
    name: "send_message",
    operationType: "write",
    description: "Send a new message from the bot into an existing Teams conversation.",
    inputSchema: s.actionInput(
      {
        serviceUrl: s.optional(serviceUrl),
        conversationId,
        threadId: s.optional(threadId),
        text,
        textFormat: s.optional(textFormat),
      },
      ["conversationId", "text"],
    ),
    outputSchema: resourceResponse,
  },
  {
    name: "reply_to_message",
    operationType: "write",
    description: "Reply to an existing activity in a Teams conversation.",
    inputSchema: s.actionInput(
      {
        serviceUrl: s.optional(serviceUrl),
        conversationId,
        threadId: s.optional(threadId),
        activityId,
        text,
        textFormat: s.optional(textFormat),
      },
      ["conversationId", "activityId", "text"],
    ),
    outputSchema: resourceResponse,
  },
  {
    name: "update_message",
    operationType: "write",
    description: "Replace the text of a message the bot previously sent.",
    inputSchema: s.actionInput(
      {
        serviceUrl: s.optional(serviceUrl),
        conversationId,
        threadId: s.optional(threadId),
        activityId,
        text,
        textFormat: s.optional(textFormat),
      },
      ["conversationId", "activityId", "text"],
    ),
    outputSchema: resourceResponse,
  },
  {
    name: "delete_message",
    operationType: "destructive",
    description: "Delete a message the bot previously sent.",
    inputSchema: s.actionInput(
      { serviceUrl: s.optional(serviceUrl), conversationId, threadId: s.optional(threadId), activityId },
      ["conversationId", "activityId"],
    ),
    outputSchema: s.actionOutput({ deleted: s.boolean("Whether the Bot Connector accepted the deletion.") }),
  },
  {
    name: "create_conversation",
    operationType: "write",
    description:
      "Start a proactive one-on-one conversation with a user, or a new thread in a team's general channel, and optionally post a first message.",
    inputSchema: s.actionInput(
      {
        serviceUrl: s.optional(serviceUrl),
        memberId: s.optional(
          s.nonEmptyString(
            "Teams user ID (for example 29:...) to start a one-on-one conversation with; email and UPN are not supported. Omit when targeting a team.",
          ),
        ),
        teamId: s.optional(
          s.nonEmptyString(
            "Teams team ID to start a new thread in the team's general channel. Requires text. Omit for a one-on-one chat.",
          ),
        ),
        tenantId: s.optional(
          s.nonEmptyString("Tenant of the target user or team. Defaults to the credential's tenant."),
        ),
        text: s.optional(text),
        textFormat: s.optional(textFormat),
      },
      [],
    ),
    outputSchema: s.object(
      {
        id: s.string("ID of the created conversation."),
        activityId: s.string("ID of the first message, when text was sent."),
        serviceUrl: s.string("Service URL to use for follow-up actions in this conversation."),
      },
      {
        additionalProperties: true,
        description: "Created conversation reference.",
        optional: ["activityId", "serviceUrl"],
      },
    ),
  },
  {
    name: "list_conversation_members",
    operationType: "read",
    description: "List one page of the members of a Teams conversation.",
    inputSchema: s.actionInput(
      {
        serviceUrl: s.optional(serviceUrl),
        conversationId,
        pageSize: s.optional(
          s.integer("Members per page, from 50 to 500. Teams defaults to 200.", { minimum: 50, maximum: 500 }),
        ),
        continuationToken: s.optional(s.nonEmptyString("Token from a previous page's continuationToken.")),
      },
      ["conversationId"],
    ),
    outputSchema: s.actionOutput(
      {
        members: s.array(channelAccount, { description: "Members in this page." }),
        continuationToken: s.optional(s.string("Token for the next page. Absent on the last page.")),
      },
      "Page of conversation members.",
      ["members"],
    ),
  },
];

export const microsoftTeamsBotActions: ActionDefinition[] = actions.map((action) =>
  defineProviderAction(service, action),
);
