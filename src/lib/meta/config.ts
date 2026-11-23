import "server-only";
import { openPageToken, sealPageToken } from "./oauth";

export function graphVersion() {
  const version = process.env.META_GRAPH_API_VERSION;
  if (!version || !/^v[0-9]+\.[0-9]+$/.test(version)) throw new Error("Meta Graph API version is unconfigured");
  return version;
}

export const messengerScopes = ["pages_show_list", "pages_messaging", "pages_manage_metadata"];

export function metaOAuthConfig() {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const stateSecret = process.env.META_OAUTH_STATE_SECRET;
  const redirectUri = process.env.META_OAUTH_REDIRECT_URI;
  if (!appId || !appSecret || !stateSecret || stateSecret.length < 32 || !redirectUri) throw new Error("Meta OAuth is unconfigured");
  const url = new URL(redirectUri);
  if (url.protocol !== "https:" || url.pathname !== "/api/meta/oauth/callback" || url.search || url.hash) {
    throw new Error("Invalid Meta OAuth redirect URI");
  }
  return { appId, appSecret, stateSecret, redirectUri, version: graphVersion(), scopes: messengerScopes, configId: process.env.META_LOGIN_CONFIG_ID };
}

function encryptionKey() {
  const key = Buffer.from(process.env.META_PAGE_TOKEN_KEY ?? "", "base64");
  if (key.length !== 32) throw new Error("Meta Page encryption is unconfigured");
  return key;
}

function tokenContext(org: string, page: string) {
  return `oniro:messenger:${org}:${page}`;
}

export function encryptCredential(token: string, org: string, page: string) {
  return sealPageToken(token, encryptionKey(), tokenContext(org, page));
}

export function decryptCredential(encrypted: string, org: string, page: string) {
  return openPageToken(encrypted, encryptionKey(), tokenContext(org, page));
}
