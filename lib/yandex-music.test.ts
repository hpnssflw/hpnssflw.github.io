import { describe, expect, it } from "vitest";
import { normalizePlaylists } from "./yandex-music";

// Trimmed from the real GET /users/tmkplzv/playlists/list response, 2026-09-28
// (the same { result: [...] } shape run.mjs publishes as playlists.json).
const REAL = {
  result: [
    {
      kind: 1002,
      title: "love",
      playlistUuid: "85b6b547-f746-0730-a659-1acf915d3a91",
      visibility: "public",
      trackCount: 84,
      durationMs: 21399780,
      modified: "2026-09-22T10:38:56+00:00",
      cover: {
        type: "mosaic",
        itemsUri: [
          "avatars.yandex.net/get-music-content/10874616/6a21a67a.a.29844684-1/%%",
          "avatars.yandex.net/get-music-content/3334966/c3bf22c2.a.13061339-1/%%",
          "avatars.yandex.net/get-music-content/3334966/7e906cd1.a.12533388-1/%%",
          "avatars.yandex.net/get-music-content/34131/4b65b70c.a.2777752-1/%%",
        ],
      },
    },
    {
      kind: 1001,
      title: "siick vibin on a daily basis",
      playlistUuid: "f5db5527-5d0e-50fa-9f52-ee32cf758900",
      visibility: "public",
      trackCount: 265,
      durationMs: 48357650,
      modified: "2026-09-28T05:06:23+00:00",
      cover: {
        type: "mosaic",
        itemsUri: [
          "avatars.yandex.net/get-music-content/97284/666ef04f.a.5907678-1/%%",
          "avatars.yandex.net/get-music-content/20622967/0b58311f.a.43768630-1/%%",
          "avatars.yandex.net/get-music-content/9868087/d29c89b6.a.32425695-1/%%",
          "avatars.yandex.net/get-music-content/21498071/4fd3001b.a.43778747-1/%%",
        ],
      },
    },
    {
      kind: 1000,
      title: "technical 🔻",
      playlistUuid: "b8cd6752-8da7-b834-8cd3-4efe15ef2cfe",
      visibility: "public",
      trackCount: 93,
      durationMs: 34700980,
      modified: "2026-09-24T09:51:57+00:00",
      cover: {
        type: "mosaic",
        itemsUri: [
          "avatars.yandex.net/get-music-content/15142616/0928db36.a.36289324-1/%%",
          "avatars.yandex.net/get-music-content/14439424/68767247.a.36770188-1/%%",
          "avatars.yandex.net/get-music-content/19999910/535af968.a.15210252-3/%%",
          "avatars.yandex.net/get-music-content/4785246/ed0c0d78.a.14813904-1/%%",
        ],
      },
    },
  ],
};

const ONE = REAL.result[1];

describe("normalizePlaylists", () => {
  it("normalizes the real response, newest first", () => {
    const out = normalizePlaylists(REAL);
    expect(out.map((p) => p.title)).toEqual([
      "siick vibin on a daily basis",
      "technical 🔻",
      "love",
    ]);
    expect(out[0]).toEqual({
      uuid: "f5db5527-5d0e-50fa-9f52-ee32cf758900",
      title: "siick vibin on a daily basis",
      trackCount: 265,
      durationMs: 48357650,
      modified: "2026-09-28T05:06:23+00:00",
      coverTiles: [
        "https://avatars.yandex.net/get-music-content/97284/666ef04f.a.5907678-1/200x200",
        "https://avatars.yandex.net/get-music-content/20622967/0b58311f.a.43768630-1/200x200",
        "https://avatars.yandex.net/get-music-content/9868087/d29c89b6.a.32425695-1/200x200",
        "https://avatars.yandex.net/get-music-content/21498071/4fd3001b.a.43778747-1/200x200",
      ],
      url: "https://music.yandex.ru/playlists/f5db5527-5d0e-50fa-9f52-ee32cf758900",
      embedUrl:
        "https://music.yandex.ru/iframe/playlists/f5db5527-5d0e-50fa-9f52-ee32cf758900",
    });
  });

  it("drops non-public playlists", () => {
    expect(normalizePlaylists({ result: [{ ...ONE, visibility: "private" }] })).toEqual([]);
  });

  it("skips items without a valid uuid or title", () => {
    const noUuid = { ...ONE, playlistUuid: undefined };
    expect(
      normalizePlaylists({
        result: [
          noUuid,
          { ...ONE, playlistUuid: "../../evil" },
          { ...ONE, title: "" },
          "not an object",
        ],
      }),
    ).toEqual([]);
  });

  it("caps the mosaic at four tiles", () => {
    const cover = { type: "mosaic", itemsUri: ["a/%%", "b/%%", "c/%%", "d/%%", "e/%%", "f/%%"] };
    const [p] = normalizePlaylists({ result: [{ ...ONE, cover }] });
    expect(p.coverTiles).toEqual([
      "https://a/200x200",
      "https://b/200x200",
      "https://c/200x200",
      "https://d/200x200",
    ]);
  });

  it("returns no tiles for a missing or non-mosaic cover", () => {
    const noCover = { ...ONE, cover: undefined };
    const pic = { ...ONE, cover: { type: "pic", uri: "avatars.yandex.net/x/%%" } };
    const out = normalizePlaylists({ result: [noCover, pic] });
    expect(out.map((p) => p.coverTiles)).toEqual([[], []]);
  });

  it("returns [] for garbage", () => {
    expect(normalizePlaylists(null)).toEqual([]);
    expect(normalizePlaylists("x")).toEqual([]);
    expect(normalizePlaylists({})).toEqual([]);
    expect(normalizePlaylists({ result: "nope" })).toEqual([]);
  });
});
