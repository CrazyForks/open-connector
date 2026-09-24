export const googleSearchConsoleReadonlyScope = "https://www.googleapis.com/auth/webmasters.readonly";
export const googleSearchConsoleFullScope = "https://www.googleapis.com/auth/webmasters";
export const googleOpenIdScope = "openid";
export const googleEmailScope = "email";
export const googleProfileScope = "profile";

export const googleSearchConsoleReadScopes: string[] = [googleSearchConsoleReadonlyScope];
export const googleSearchConsoleWriteScopes: string[] = [googleSearchConsoleFullScope];
export const googleSearchConsoleOAuthScopes: string[] = [
  googleSearchConsoleReadonlyScope,
  googleSearchConsoleFullScope,
  googleOpenIdScope,
  googleEmailScope,
  googleProfileScope,
];
