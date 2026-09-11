import { looseArray, optionalRecord, optionalString } from "../../core/cast.ts";
import { ProviderRequestError } from "../provider-runtime.ts";

/** Apple Maps Server API 只有这一个 origin */
export const appleMapsApiOrigin = "https://maps-api.apple.com";

/**
 * 用 maps auth token 换取 maps access token 的端点。
 *
 * 它回出来的是能调用全部业务端点的 bearer 凭证, 所以只在 runtime 内部使用:
 * 不做成 action, 也不在 proxy 的放行路径里。
 */
export const appleMapsTokenPath = "/v1/token";

/** 出现在共享超时与传输失败消息里的 provider 名 */
export const appleMapsProviderLabel = "Apple Maps";

/**
 * 失败发生在凭证校验阶段还是 action / proxy 执行阶段。
 *
 * 校验阶段 /v1/token 回 401 说明密钥被拒绝, 是连接表单上的字段错误 (400 invalid_input);
 * 校验阶段的其余状态和执行阶段的全部状态都把上游状态原样透传, 不因为裸 401/403 引导用户重新授权。
 */
export type AppleMapsPhase = "execute" | "validate";

const rejectedKeyMessage =
  "Apple Maps rejected the key. Check the Team ID, Key ID and private key, and check that the key has MapKit JS enabled and is associated with a Maps ID.";

export async function readAppleMapsPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // 网关层的失败答复可能是纯文本; 保留原文让错误消息回退到 HTTP 状态, 不在解析阶段失败
    return text;
  }
}

/**
 * 把 Apple Maps 的失败答复映射成 ProviderRequestError。
 *
 * 每个分支都把解析后的响应体挂在 data 上。执行阶段的 401/403 保持 provider_error 并透传上游状态:
 * Apple 对 401 只记录了一个笼统的 "Maps access token 缺失或无效", 实测错误体也只有 "Not Authorized",
 * 分不清密钥被吊销、密钥没开 MapKit JS 还是时钟偏差, 不能据此引导重新授权。
 *
 * 校验阶段只有 401 报告成密钥被拒绝: /v1/token 文档只列出 200、401、429 和 500, 2026-09-11 实测
 * 各种错误凭证 (未知 kid、缺 kid、过期、scope 不对) 也都回 401 JSON。403 对密钥没有文档或实测依据,
 * 保持 provider_error 和原始状态, 免得用户去吊销一把正常的密钥, 而 .p8 文件只能下载一次。
 */
export function createAppleMapsError(status: number, payload: unknown, phase: AppleMapsPhase): ProviderRequestError {
  if (phase === "validate" && status === 401) {
    return new ProviderRequestError(400, rejectedKeyMessage, payload);
  }

  const message = readAppleMapsErrorMessage(status, payload);
  if (status === 429) {
    return new ProviderRequestError(429, message, payload);
  }
  if (status === 401 || status === 403) {
    return new ProviderRequestError(status, message, payload);
  }
  if (status >= 400 && status < 500) {
    return new ProviderRequestError(status, message, payload);
  }
  return new ProviderRequestError(500 <= status && status < 600 ? status : 502, message, payload);
}

/**
 * 从错误体里拼出 message 与 details。
 *
 * 文档记的 ErrorResponse 是 `{ message, details }`, 实测线上回的却是
 * `{ error: { message, details } }`, 两种形状都要认。
 */
function readAppleMapsErrorMessage(status: number, payload: unknown): string {
  const body = optionalRecord(payload) ?? {};
  const error = optionalRecord(body.error) ?? body;
  const details = looseArray(error.details).flatMap((detail) => {
    const text = optionalString(detail);
    return text ? [text] : [];
  });
  const summary = [optionalString(error.message), details.join("; ")].filter((part) => part).join(": ");

  return summary || `Apple Maps request failed with HTTP ${status}`;
}
