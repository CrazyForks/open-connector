import type { CredentialValidationResult } from "../../core/types.ts";
import type { AppleMapsCredential } from "./auth.ts";

import { looseArray, optionalRecord } from "../../core/cast.ts";
import {
  ProviderRequestError,
  providerUserAgent,
  requiredResponseRecord,
  runProviderRequest,
} from "../provider-runtime.ts";
import {
  acquireAppleMapsAccessToken,
  evictAppleMapsAccessToken,
  exchangeAppleMapsAccessTokenForValidation,
  readAppleMapsCredential,
} from "./auth.ts";
import {
  appleMapsApiOrigin,
  appleMapsProviderLabel,
  appleMapsTokenPath,
  createAppleMapsError,
  readAppleMapsPayload,
} from "./client.ts";

export interface AppleMapsRunContext {
  credential: AppleMapsCredential;
  fetcher: typeof fetch;
}

interface Coordinate {
  latitude: number;
  longitude: number;
}

interface MapRegion {
  northLatitude: number;
  eastLongitude: number;
  southLatitude: number;
  westLongitude: number;
}

/** 地理编码、搜索与自动补全共有的提示参数 */
interface SearchHintInput {
  lang?: string;
  limitToCountries?: string[];
  searchLocation?: Coordinate;
  searchRegion?: MapRegion;
  userLocation?: Coordinate;
}

interface GeocodeAddressInput extends SearchHintInput {
  query: string;
}

interface ReverseGeocodeInput {
  location: Coordinate;
  lang?: string;
}

interface PlaceFilterInput extends SearchHintInput {
  query: string;
  includePoiCategories?: string[];
  excludePoiCategories?: string[];
  resultTypeFilter?: string[];
  includeAddressCategories?: string[];
  excludeAddressCategories?: string[];
  searchRegionPriority?: string;
}

interface SearchPlacesInput extends PlaceFilterInput {
  enablePagination?: boolean;
  pageToken?: string;
}

interface GetPlaceInput {
  placeId: string;
  lang?: string;
}

interface GetPlacesInput {
  placeIds: string[];
  lang?: string;
}

interface GetDirectionsInput {
  origin: string;
  destination: string;
  arrivalDate?: string;
  departureDate?: string;
  avoid?: string[];
  lang?: string;
  requestsAlternateRoutes?: boolean;
  searchLocation?: Coordinate;
  searchRegion?: MapRegion;
  userLocation?: Coordinate;
  transportType?: string;
  includeStepPaths?: boolean;
}

interface GetEtasInput {
  origin: Coordinate;
  destinations: Coordinate[];
  transportType?: string;
  departureDate?: string;
  arrivalDate?: string;
}

/** action 名到 (已经过 inputSchema 校验的) 输入形状 */
interface AppleMapsActionInputs {
  geocode_address: GeocodeAddressInput;
  reverse_geocode: ReverseGeocodeInput;
  search_places: SearchPlacesInput;
  autocomplete_search: PlaceFilterInput;
  get_place: GetPlaceInput;
  get_places: GetPlacesInput;
  get_alternate_place_ids: { placeIds: string[] };
  get_directions: GetDirectionsInput;
  get_etas: GetEtasInput;
}

type AppleMapsHandlers = {
  [Name in keyof AppleMapsActionInputs]: (
    input: AppleMapsActionInputs[Name],
    context: AppleMapsRunContext,
  ) => Promise<unknown>;
};

/** 值为 undefined 或空串的参数整个省略, 不发空参数 */
type QueryParams = Record<string, string | undefined>;

interface AppleMapsResponse {
  ok: boolean;
  status: number;
  payload: unknown;
}

const appleMapsActionHandlers: AppleMapsHandlers = {
  async geocode_address(input, context) {
    const payload = await requestAppleMaps(context, "/v1/geocode", {
      q: input.query,
      ...searchHintParams(input),
    });
    return { results: looseArray(requiredResponseRecord(payload, "Apple Maps geocode response").results) };
  },

  async reverse_geocode(input, context) {
    const payload = await requestAppleMaps(context, "/v1/reverseGeocode", {
      loc: formatCoordinate(input.location),
      lang: input.lang,
    });
    return { results: looseArray(requiredResponseRecord(payload, "Apple Maps reverse geocode response").results) };
  },

  async search_places(input, context) {
    const payload = await requestAppleMaps(context, "/v1/search", {
      q: input.query,
      ...placeFilterParams(input),
      enablePagination: booleanString(input.enablePagination),
      pageToken: input.pageToken,
    });
    const body = requiredResponseRecord(payload, "Apple Maps search response");
    return {
      results: looseArray(body.results),
      displayMapRegion: optionalRecord(body.displayMapRegion) ?? null,
      paginationInfo: optionalRecord(body.paginationInfo) ?? null,
    };
  },

  async autocomplete_search(input, context) {
    const payload = await requestAppleMaps(context, "/v1/searchAutocomplete", {
      q: input.query,
      ...placeFilterParams(input),
    });
    return {
      results: looseArray(requiredResponseRecord(payload, "Apple Maps search autocomplete response").results),
    };
  },

  async get_place(input, context) {
    // "." 与 ".." 编码后原样不变, 拼进路径会被 URL 解析吃掉, 请求就落到别的端点上
    if (input.placeId === "." || input.placeId === "..") {
      throw new ProviderRequestError(400, "placeId must be an Apple Maps Place ID");
    }
    const payload = await requestAppleMaps(context, `/v1/place/${encodeURIComponent(input.placeId)}`, {
      lang: input.lang,
    });
    return { place: requiredResponseRecord(payload, "Apple Maps place response") };
  },

  async get_places(input, context) {
    const payload = await requestAppleMaps(context, "/v1/place", {
      ids: input.placeIds.join(","),
      lang: input.lang,
    });
    const body = requiredResponseRecord(payload, "Apple Maps places response");
    return { results: looseArray(body.results), errors: looseArray(body.errors) };
  },

  async get_alternate_place_ids(input, context) {
    const payload = await requestAppleMaps(context, "/v1/place/alternateIds", {
      ids: input.placeIds.join(","),
    });
    const body = requiredResponseRecord(payload, "Apple Maps alternate place IDs response");
    return { results: looseArray(body.results), errors: looseArray(body.errors) };
  },

  async get_directions(input, context) {
    // arrivalDate 与 departureDate 互斥已经由 inputSchema 的 refine 在发请求前拦下
    const payload = await requestAppleMaps(context, "/v1/directions", {
      origin: input.origin,
      destination: input.destination,
      arrivalDate: formatUtcDateTime(input.arrivalDate, "arrivalDate"),
      departureDate: formatUtcDateTime(input.departureDate, "departureDate"),
      avoid: joinList(input.avoid),
      lang: input.lang,
      requestsAlternateRoutes: booleanString(input.requestsAlternateRoutes),
      searchLocation: formatOptionalCoordinate(input.searchLocation),
      searchRegion: formatOptionalRegion(input.searchRegion),
      userLocation: formatOptionalCoordinate(input.userLocation),
      transportType: input.transportType,
    });
    const body = requiredResponseRecord(payload, "Apple Maps directions response");
    return {
      origin: optionalRecord(body.origin) ?? null,
      destination: optionalRecord(body.destination) ?? null,
      routes: looseArray(body.routes),
      steps: looseArray(body.steps),
      // Apple 总是返回全部折线, 体积可能很大; 只有调用方明确要时才透传
      stepPaths: input.includeStepPaths === true ? looseArray(body.stepPaths) : null,
    };
  },

  async get_etas(input, context) {
    const payload = await requestAppleMaps(context, "/v1/etas", {
      origin: formatCoordinate(input.origin),
      destinations: input.destinations.map(formatCoordinate).join("|"),
      transportType: input.transportType,
      departureDate: formatUtcDateTime(input.departureDate, "departureDate"),
      arrivalDate: formatUtcDateTime(input.arrivalDate, "arrivalDate"),
    });
    return { etas: looseArray(requiredResponseRecord(payload, "Apple Maps ETA response").etas) };
  },
};

export async function executeAppleMapsAction(
  actionName: string,
  input: Record<string, unknown>,
  context: AppleMapsRunContext,
): Promise<unknown> {
  if (!Object.hasOwn(appleMapsActionHandlers, actionName)) {
    throw new ProviderRequestError(400, `unknown apple_maps action: ${actionName}`);
  }
  validateAppleMapsInput(actionName, input);
  // input 已经过该 action 的 inputSchema 校验 (含默认值与 trim), 形状与 AppleMapsActionInputs 的对应条目一致
  const handler = appleMapsActionHandlers[actionName as keyof AppleMapsActionInputs] as (
    input: unknown,
    context: AppleMapsRunContext,
  ) => Promise<unknown>;
  return handler(input, context);
}

function validateAppleMapsInput(actionName: string, input: Record<string, unknown>): void {
  if (actionName === "get_directions" && input.arrivalDate !== undefined && input.departureDate !== undefined) {
    throw new ProviderRequestError(400, "arrivalDate and departureDate cannot be used together");
  }
  if (actionName !== "search_places" && actionName !== "autocomplete_search") return;
  const filtersAddresses = input.includeAddressCategories !== undefined || input.excludeAddressCategories !== undefined;
  const resultTypes = Array.isArray(input.resultTypeFilter) ? input.resultTypeFilter : undefined;
  if (filtersAddresses && resultTypes && !resultTypes.includes("address")) {
    throw new ProviderRequestError(
      400,
      "resultTypeFilter must include address when includeAddressCategories or excludeAddressCategories is set",
    );
  }
}

/**
 * 用 GET /v1/token 验证一把已配置的密钥。
 *
 * 换取成功就说明 Team ID、Key ID 与私钥匹配且密钥开通了 Maps 服务; 401 由共享映射报告成
 * 连接表单字段错误, 其余失败保留上游状态。Maps Server API 没有账号或团队信息端点, 所以身份只能取自
 * 用户填的 Team ID。
 */
export async function validateAppleMapsCredential(
  values: Record<string, string>,
  fetcher: typeof fetch,
): Promise<CredentialValidationResult> {
  const credential = readAppleMapsCredential(values);
  await exchangeAppleMapsAccessTokenForValidation(credential, fetcher);

  return {
    profile: { accountId: `apple_maps:${credential.teamId}`, displayName: `Apple Maps team ${credential.teamId}` },
    metadata: {
      apiBaseUrl: appleMapsApiOrigin,
      validationEndpoint: appleMapsTokenPath,
      teamId: credential.teamId,
      keyId: credential.keyId,
    },
  };
}

/**
 * 发一次业务 GET 请求, 返回 2xx 响应解析后的响应体。
 *
 * 被 401 拒绝的 token 一律移出缓存, 避免下一次运行再拿它碰一次 401。取自缓存的 token 被拒绝时,
 * 重新取一次 token 重试且只重试一次: 淘汰之后如果并发运行已经换到了新 token 就直接用它,
 * 否则发起新的换取, 两种情况都不会再用被拒绝的那一个。本次运行刚换到的 token 被拒绝说明问题出在
 * 密钥本身, 直接报错不重试。
 */
async function requestAppleMaps(context: AppleMapsRunContext, path: string, params: QueryParams): Promise<unknown> {
  const url = `${appleMapsApiOrigin}${path}${buildQueryString(params)}`;
  const lease = await acquireAppleMapsAccessToken(context.credential, context.fetcher);
  let response = await sendAppleMapsRequest(context.fetcher, url, lease.accessToken);
  if (response.status === 401) {
    evictAppleMapsAccessToken(context.credential, lease.accessToken);
    if (lease.fromCache) {
      const retryLease = await acquireAppleMapsAccessToken(context.credential, context.fetcher);
      response = await sendAppleMapsRequest(context.fetcher, url, retryLease.accessToken);
      if (response.status === 401) {
        evictAppleMapsAccessToken(context.credential, retryLease.accessToken);
      }
    }
  }

  if (!response.ok) {
    throw createAppleMapsError(response.status, response.payload, "execute");
  }
  return response.payload;
}

async function sendAppleMapsRequest(
  fetcher: typeof fetch,
  url: string,
  accessToken: string,
): Promise<AppleMapsResponse> {
  return runProviderRequest({ label: appleMapsProviderLabel }, async (signal) => {
    const response = await fetcher(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        "user-agent": providerUserAgent,
      },
      signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      payload: await readAppleMapsPayload(response),
    };
  });
}

/**
 * 拼查询串。
 *
 * 用 encodeURIComponent 把空格编成 %20, 与 Apple 文档示例一致, 不用 URLSearchParams 那种 "+"。
 */
function buildQueryString(params: QueryParams): string {
  const pairs = Object.entries(params).flatMap(([name, value]) =>
    value === undefined || value === "" ? [] : [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`],
  );
  return pairs.length > 0 ? `?${pairs.join("&")}` : "";
}

function searchHintParams(input: SearchHintInput): QueryParams {
  return {
    limitToCountries: joinList(input.limitToCountries),
    lang: input.lang,
    searchLocation: formatOptionalCoordinate(input.searchLocation),
    searchRegion: formatOptionalRegion(input.searchRegion),
    userLocation: formatOptionalCoordinate(input.userLocation),
  };
}

function placeFilterParams(input: PlaceFilterInput): QueryParams {
  return {
    ...searchHintParams(input),
    includePoiCategories: joinList(input.includePoiCategories),
    excludePoiCategories: joinList(input.excludePoiCategories),
    resultTypeFilter: joinList(input.resultTypeFilter),
    includeAddressCategories: joinList(input.includeAddressCategories),
    excludeAddressCategories: joinList(input.excludeAddressCategories),
    searchRegionPriority: input.searchRegionPriority,
  };
}

/** Apple 的列表参数是逗号分隔的字符串; 空列表整个省略 */
function joinList(values: readonly string[] | undefined): string | undefined {
  return values && values.length > 0 ? values.join(",") : undefined;
}

function formatCoordinate(coordinate: Coordinate): string {
  return `${formatDecimal(coordinate.latitude)},${formatDecimal(coordinate.longitude)}`;
}

function formatOptionalCoordinate(coordinate: Coordinate | undefined): string | undefined {
  return coordinate ? formatCoordinate(coordinate) : undefined;
}

/** SearchRegion 的顺序是 north-latitude, east-longitude, south-latitude, west-longitude */
function formatOptionalRegion(region: MapRegion | undefined): string | undefined {
  return region
    ? [region.northLatitude, region.eastLongitude, region.southLatitude, region.westLongitude]
        .map(formatDecimal)
        .join(",")
    : undefined;
}

/**
 * 把坐标数值写成不带指数的十进制文本。
 *
 * Number#toString 在绝对值小于 1e-6 时会输出 "1e-7" 这样的指数写法, Apple 的逗号坐标串不认它。
 * 这里把指数展开成普通小数, 保留 toString 给出的全部有效数字 (toFixed 会补出二进制误差位)。
 * 经纬度绝对值不超过 180, 不会出现正指数。
 */
function formatDecimal(value: number): string {
  const text = String(value);
  const exponentIndex = text.indexOf("e-");
  if (exponentIndex === -1) {
    return text;
  }

  const negative = text.startsWith("-");
  const mantissa = text.slice(negative ? 1 : 0, exponentIndex);
  const exponent = Number(text.slice(exponentIndex + "e-".length));
  const [integerDigits = "", fractionDigits = ""] = mantissa.split(".");
  // 指数写法的整数部分只有一位; 小数点左移 exponent 位, 等于在有效数字前补 exponent - 1 个零
  const leadingZeros = "0".repeat(exponent - integerDigits.length);
  return `${negative ? "-" : ""}0.${leadingZeros}${integerDigits}${fractionDigits}`;
}

/**
 * 把已通过 date-time 校验的时间写成 Apple 文档的 UTC 秒级写法, 例如 2023-04-15T16:42:00Z。
 *
 * Apple 文档要求 UTC 时间; 带时区偏移的输入换算成同一时刻的 UTC, 小数秒舍去。date-time 格式还放行
 * "+08" 这种只写小时的偏移和闰秒 60, Date.parse 解析不了它们, 这时报 400, 不把 Apple 可能误读的原文发出去。
 * date-time 格式要求四位年份, 所以 toISOString 不会出现扩展年份, 截取前 19 位是安全的。
 */
function formatUtcDateTime(value: string | undefined, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    throw new ProviderRequestError(
      400,
      `${fieldName} must be an ISO 8601 date-time Apple can read, such as 2023-04-15T16:42:00Z`,
    );
  }
  return `${new Date(time).toISOString().slice(0, 19)}Z`;
}

function booleanString(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}
