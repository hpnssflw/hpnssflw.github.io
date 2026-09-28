/**
 * Minimal GitHub Contents API client for the inbox's owner mode
 * (/researcher/queue/). The token only ever goes to api.github.com, in
 * the Authorization header.
 */

const API = "https://api.github.com";

/** 401/403: the token is missing, expired, revoked, or lacks access. */
export class GitHubAuthError extends Error {
  name = "GitHubAuthError";
}

/** 409/422: the file changed since its sha was read (e.g. another tab). */
export class GitHubConflictError extends Error {
  name = "GitHubConflictError";
}

export interface FileSnapshot {
  text: string;
  sha: string;
}

function headers(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function toError(res: Response, what: string): Error {
  if (res.status === 401 || res.status === 403) {
    return new GitHubAuthError(`${what}: ${res.status}`);
  }
  if (res.status === 409 || res.status === 422) {
    return new GitHubConflictError(`${what}: ${res.status}`);
  }
  return new Error(`${what}: ${res.status}`);
}

/** btoa only takes Latin-1, and item titles carry any Unicode. */
export function encodeBase64Utf8(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** GitHub wraps base64 content at 60 columns; whitespace is stripped first. */
export function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

export async function getFile(repo: string, path: string, token: string): Promise<FileSnapshot> {
  const res = await fetch(`${API}/repos/${repo}/contents/${path}`, {
    headers: headers(token),
    cache: "no-store",
  });
  if (!res.ok) throw toError(res, `GET ${path}`);
  const body = (await res.json()) as { content?: unknown; sha?: unknown };
  if (typeof body.content !== "string" || typeof body.sha !== "string") {
    throw new Error(`GET ${path}: unexpected response`);
  }
  return { text: decodeBase64Utf8(body.content), sha: body.sha };
}

export async function putFile(
  repo: string,
  path: string,
  text: string,
  sha: string,
  message: string,
  token: string,
): Promise<{ sha: string }> {
  const res = await fetch(`${API}/repos/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: encodeBase64Utf8(text), sha }),
  });
  if (!res.ok) throw toError(res, `PUT ${path}`);
  const body = (await res.json()) as { content?: { sha?: unknown } };
  if (typeof body.content?.sha !== "string") {
    throw new Error(`PUT ${path}: unexpected response`);
  }
  return { sha: body.content.sha };
}
