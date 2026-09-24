export const youtubeReadScope = "https://www.googleapis.com/auth/youtube.readonly";
export const youtubeWriteScope = "https://www.googleapis.com/auth/youtube.force-ssl";
export const googleOpenIdScope = "openid";
export const googleEmailScope = "email";
export const googleProfileScope = "profile";

export const youtubeReadScopes: string[] = [youtubeReadScope];
export const youtubeWriteScopes: string[] = [youtubeWriteScope];
export const youtubeProviderScopes: string[] = [
  youtubeReadScope,
  youtubeWriteScope,
  googleOpenIdScope,
  googleEmailScope,
  googleProfileScope,
];
