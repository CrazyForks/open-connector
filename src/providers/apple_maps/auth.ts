import type { AppleMapsPhase } from "./client.ts";

import { importPKCS8, SignJWT } from "jose";
import { sha256Hex } from "../../core/aws-sigv4.ts";
import { optionalNumber, requiredString } from "../../core/cast.ts";
import {
  ProviderRequestError,
  providerResponseError,
  providerUserAgent,
  requiredInputString,
  requiredResponseRecord,
  runProviderRequest,
} from "../provider-runtime.ts";
import {
  appleMapsApiOrigin,
  appleMapsProviderLabel,
  appleMapsTokenPath,
  createAppleMapsError,
  readAppleMapsPayload,
} from "./client.ts";

/**
 * maps auth token 只用来换一次 access token。
 * 5 分钟足够覆盖一次换取请求, 万一泄漏, 可用窗口也很短。
 */
const authTokenLifetimeSeconds = 300;
/** 在 Apple 给出的过期时间之前提前这么久换新, 避免请求发出时 token 恰好过期 */
const accessTokenRefreshLeewayMs = 60_000;
/** 进程内缓存最多保留的凭证条目数; 超出时淘汰最久未用的条目 */
const maximumTokenCacheEntries = 256;
const pkcs8Marker = "-----BEGIN PRIVATE KEY-----";

export interface AppleMapsCredential {
  teamId: string;
  keyId: string;
  /** 已把字面 \n 还原成真实换行的 PKCS#8 PEM 文本 */
  privateKey: string;
}

export interface AppleMapsAccessTokenLease {
  accessToken: string;
  /**
   * true 表示 token 取自此前已经换好的缓存。
   * 本次调用刚换到的 token, 以及加入别人在途换取得到的 token, 都是 false。
   */
  fromCache: boolean;
}

interface ExchangedAccessToken {
  accessToken: string;
  /** 过了这个时刻就不再复用; undefined 表示 Apple 没给出可用的有效期, 只用于当前请求 */
  refreshAt: number | undefined;
}

interface TokenCacheEntry {
  token?: { accessToken: string; refreshAt: number };
  /** 同一凭证正在进行的换取; 并发的执行路径加入它而不是各自再换一次 */
  pending?: Promise<ExchangedAccessToken>;
}

/**
 * 进程内的 access token 缓存, key 是凭证的 SHA-256。
 *
 * 换取本身是一次上游调用, 要占用团队每天 25,000 次的共享配额; auth token 则是本地签的,
 * 所以缓存的是换回来的 access token, 而不是 auth token。
 */
const tokenCache = new Map<string, TokenCacheEntry>();

export function resetAppleMapsTokenCacheForTests(): void {
  tokenCache.clear();
}

/**
 * 读取连接时保存的三个凭证字段。
 *
 * 单行输入框和 JSON 调用方都可能把 PEM 里的换行写成字面 "\n", 先还原再检查 PEM 标记;
 * 缺少标记直接报 400, 错误消息里不回显任何私钥内容。
 */
export function readAppleMapsCredential(values: Record<string, string | undefined>): AppleMapsCredential {
  const teamId = requiredInputString(values.teamId, "teamId");
  const keyId = requiredInputString(values.keyId, "keyId");
  const privateKey = requiredInputString(values.privateKey, "privateKey").replaceAll("\\n", "\n");
  if (!privateKey.includes(pkcs8Marker)) {
    throw new ProviderRequestError(
      400,
      "privateKey must be the PEM contents of the AuthKey .p8 file, starting with -----BEGIN PRIVATE KEY-----",
    );
  }

  return { teamId, keyId, privateKey };
}

/**
 * 为 action 或 proxy 取一个 maps access token。
 *
 * 未到刷新时间的缓存 token 直接复用; 同一凭证已有在途换取时加入它 (single-flight);
 * 否则发起一次换取, 成功且有效期可用时写回缓存。失败的换取从不进缓存, 下一次调用会重新换取。
 */
export async function acquireAppleMapsAccessToken(
  credential: AppleMapsCredential,
  fetcher: typeof fetch,
): Promise<AppleMapsAccessTokenLease> {
  const key = tokenCacheKey(credential);
  const entry = tokenCache.get(key);
  if (entry?.token && Date.now() < entry.token.refreshAt) {
    rememberEntry(key, entry);
    return { accessToken: entry.token.accessToken, fromCache: true };
  }
  if (entry?.pending) {
    return { accessToken: (await entry.pending).accessToken, fromCache: false };
  }

  const pending = exchangeAccessToken(credential, fetcher, "execute");
  rememberEntry(key, { pending });
  try {
    const token = await pending;
    if (tokenCache.get(key)?.pending === pending) {
      settleEntry(key, token);
    }
    return { accessToken: token.accessToken, fromCache: false };
  } catch (error) {
    if (tokenCache.get(key)?.pending === pending) {
      tokenCache.delete(key);
    }
    throw error;
  }
}

/**
 * 业务端点以 401 拒绝某个 token 后调用。
 *
 * 只在缓存里存的仍是这一个 token 时才删除, 不误删并发运行刚换到的新 token。
 */
export function evictAppleMapsAccessToken(credential: AppleMapsCredential, accessToken: string): void {
  const key = tokenCacheKey(credential);
  if (tokenCache.get(key)?.token?.accessToken === accessToken) {
    tokenCache.delete(key);
  }
}

/**
 * 校验凭证: 不管缓存里有没有 token 都重新换取一次, 让结果反映密钥当前的状态。
 *
 * 这次换取按 validate 阶段映射错误, 所以不登记成在途条目给执行路径加入, 否则执行路径会收到
 * 连接表单的字段错误。成功后把新 token 写回缓存, 紧接着的测试动作不必再换一次。
 */
export async function exchangeAppleMapsAccessTokenForValidation(
  credential: AppleMapsCredential,
  fetcher: typeof fetch,
): Promise<void> {
  const key = tokenCacheKey(credential);
  tokenCache.delete(key);
  settleEntry(key, await exchangeAccessToken(credential, fetcher, "validate"));
}

async function exchangeAccessToken(
  credential: AppleMapsCredential,
  fetcher: typeof fetch,
  phase: AppleMapsPhase,
): Promise<ExchangedAccessToken> {
  return runProviderRequest({ label: appleMapsProviderLabel }, async (signal) => {
    // 签名放在回调里：私钥解析错误会作为 400 ProviderRequestError 原样透传。
    const authToken = await signAuthToken(credential);
    // 有效期从发请求之前算起, 网络耗时只会让刷新提前, 不会让 token 被用到过期之后
    const requestedAt = Date.now();
    const response = await fetcher(`${appleMapsApiOrigin}${appleMapsTokenPath}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${authToken}`,
        "user-agent": providerUserAgent,
      },
      signal,
    });
    const payload = await readAppleMapsPayload(response);
    if (!response.ok) {
      throw createAppleMapsError(response.status, payload, phase);
    }

    const body = requiredResponseRecord(payload, "Apple Maps token response");
    const expiresInSeconds = optionalNumber(body.expiresInSeconds);
    const lifetimeMs = expiresInSeconds !== undefined && expiresInSeconds > 0 ? expiresInSeconds * 1_000 : NaN;
    return {
      accessToken: requiredString(body.accessToken, "Apple Maps token response accessToken", providerResponseError),
      refreshAt: Number.isFinite(lifetimeMs)
        ? requestedAt + Math.max(lifetimeMs - accessTokenRefreshLeewayMs, 0)
        : undefined,
    };
  });
}

/** 签一个只用于换取 access token 的 ES256 maps auth token */
async function signAuthToken(credential: AppleMapsCredential): Promise<string> {
  const signingKey = await importAppleMapsKey(credential.privateKey);
  const issuedAt = Math.floor(Date.now() / 1000);
  // Maps Server API 只要 server_api scope; origin 只有 mapkit_js / web_snapshots / embed_api 才要求, 不带
  return new SignJWT({ scope: "server_api" })
    .setProtectedHeader({ alg: "ES256", kid: credential.keyId, typ: "JWT" })
    .setIssuer(credential.teamId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + authTokenLifetimeSeconds)
    .sign(signingKey);
}

async function importAppleMapsKey(privateKey: string): Promise<CryptoKey> {
  try {
    return await importPKCS8(privateKey, "ES256");
  } catch {
    // 不把 jose 的原始错误链上去, 避免私钥片段进入错误消息或日志
    throw new ProviderRequestError(
      400,
      "privateKey must be an EC P-256 private key in PKCS#8 PEM format, as downloaded from the Apple Developer account",
    );
  }
}

/**
 * 三个字段用 NUL 分隔后取 SHA-256, 缓存里不留任何明文凭证。
 * NUL 不会出现在这几个字段里, 所以拼接不会让两组不同的凭证撞成同一个 key。
 */
function tokenCacheKey(credential: AppleMapsCredential): string {
  return sha256Hex([credential.teamId, credential.keyId, credential.privateKey].join("\0"));
}

/** 按有效期决定写回缓存还是丢弃; 没有可用有效期的 token 只给当前请求用 */
function settleEntry(key: string, token: ExchangedAccessToken): void {
  if (token.refreshAt === undefined) {
    tokenCache.delete(key);
    return;
  }
  rememberEntry(key, { token: { accessToken: token.accessToken, refreshAt: token.refreshAt } });
}

function rememberEntry(key: string, entry: TokenCacheEntry): void {
  // 先删再插, 让 Map 的插入顺序就是最近使用顺序, 超出上限时淘汰最久未用的那一条
  tokenCache.delete(key);
  tokenCache.set(key, entry);
  if (tokenCache.size > maximumTokenCacheEntries) {
    const oldestKey = tokenCache.keys().next().value;
    if (oldestKey !== undefined) {
      tokenCache.delete(oldestKey);
    }
  }
}
