import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GitHubAuthError,
  GitHubConflictError,
  decodeBase64Utf8,
  encodeBase64Utf8,
  getFile,
  putFile,
} from "./github-contents";

afterEach(() => {
  vi.unstubAllGlobals();
});

function respond(status: number, body: unknown) {
  return vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  );
}

describe("base64 helpers", () => {
  it("round-trips non-ASCII text", () => {
    const text = "Привет — café ✓ 🚀";
    expect(decodeBase64Utf8(encodeBase64Utf8(text))).toBe(text);
  });

  it("decodes GitHub's newline-wrapped base64", () => {
    const encoded = encodeBase64Utf8("x".repeat(100));
    const wrapped = encoded.match(/.{1,60}/g)!.join("\n") + "\n";
    expect(decodeBase64Utf8(wrapped)).toBe("x".repeat(100));
  });
});

describe("getFile", () => {
  it("returns decoded text and sha, sending the token as a Bearer header", async () => {
    const fetchMock = respond(200, { content: encodeBase64Utf8("{}\n"), sha: "s1" });
    vi.stubGlobal("fetch", fetchMock);
    await expect(getFile("o/r", "f.json", "tok")).resolves.toEqual({ text: "{}\n", sha: "s1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/o/r/contents/f.json");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(init?.cache).toBe("no-store");
  });

  it("throws GitHubAuthError on 401 and 403", async () => {
    vi.stubGlobal("fetch", respond(401, {}));
    await expect(getFile("o/r", "f.json", "tok")).rejects.toBeInstanceOf(GitHubAuthError);
    vi.stubGlobal("fetch", respond(403, {}));
    await expect(getFile("o/r", "f.json", "tok")).rejects.toBeInstanceOf(GitHubAuthError);
  });

  it("throws a plain Error on 404", async () => {
    vi.stubGlobal("fetch", respond(404, {}));
    const err = await getFile("o/r", "f.json", "tok").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GitHubAuthError);
    expect(err).not.toBeInstanceOf(GitHubConflictError);
  });

  it("throws on an unexpected response body", async () => {
    vi.stubGlobal("fetch", respond(200, { sha: "s1" }));
    await expect(getFile("o/r", "f.json", "tok")).rejects.toThrow("unexpected response");
  });
});

describe("putFile", () => {
  it("PUTs base64 content with the previous sha and returns the new sha", async () => {
    const fetchMock = respond(200, { content: { sha: "s2" } });
    vi.stubGlobal("fetch", fetchMock);
    await expect(putFile("o/r", "f.json", "ü\n", "s1", "approve: x", "tok")).resolves.toEqual({
      sha: "s2",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/o/r/contents/f.json");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body as string)).toEqual({
      message: "approve: x",
      content: encodeBase64Utf8("ü\n"),
      sha: "s1",
    });
  });

  it("throws GitHubConflictError on 409 and 422", async () => {
    vi.stubGlobal("fetch", respond(409, {}));
    await expect(putFile("o/r", "f.json", "x", "s1", "m", "tok")).rejects.toBeInstanceOf(
      GitHubConflictError,
    );
    vi.stubGlobal("fetch", respond(422, {}));
    await expect(putFile("o/r", "f.json", "x", "s1", "m", "tok")).rejects.toBeInstanceOf(
      GitHubConflictError,
    );
  });

  it("throws GitHubAuthError on 401", async () => {
    vi.stubGlobal("fetch", respond(401, {}));
    await expect(putFile("o/r", "f.json", "x", "s1", "m", "tok")).rejects.toBeInstanceOf(
      GitHubAuthError,
    );
  });
});
