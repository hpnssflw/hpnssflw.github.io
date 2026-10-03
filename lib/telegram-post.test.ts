import { describe, expect, it, vi } from "vitest";
import { decodeEntities, fetchRecentPosts, parseRecentPosts } from "./telegram-post";

const latest = (html: string, channel = "hypnosisflow") => parseRecentPosts(html, channel, 1)[0] ?? null;

// Trimmed from t.me/s/hypnosisflow: two posts, then a service message
// ("pinned …"), which is the last element on the page.
function message(post: string, body: string, opts: { service?: boolean; time?: string } = {}) {
  return `<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message ${
    opts.service ? "service_message " : ""
  }js-widget_message" data-post="hypnosisflow/${post}">
  <div class="tgme_widget_message_bubble">
    <div class="tgme_widget_message_text js-message_text" dir="auto">${body}</div>
    <div class="tgme_widget_message_footer compact js-message_footer">
      <a class="tgme_widget_message_date" href="https://t.me/hypnosisflow/${post}"><time datetime="${
        opts.time ?? "2026-09-30T04:09:28+00:00"
      }" class="time">04:09</time></a>
    </div>
  </div></div></div>`;
}

const DIGEST =
  '<b>Research digest — 2 items</b><br/><br/><b>AI Engineering</b><br/>• <a href="https://www.vespper.com/blog/launching-vespper-docx-mcp" target="_blank" rel="noopener" onclick="return confirm(\'Open this link?\\n\\n\'+this.href);">Launch HN: Vespper (YC F24) – SOTA Docx MCP</a><br/>An MCP that edits Word documents.<br/><br/><b>Tooling</b><br/>• <a href="https://github.com/KKKKhazix/AIHOT?a=1&amp;b=2" target="_blank">KKKKhazix/AIHOT</a><br/>Finds trending topics &amp; writes daily reports.';

const PAGE = [
  message("93", "<b>Web Products</b><br/>• <a href=\"https://example.com/old\">Old post</a>", {
    time: "2026-09-29T00:02:41+00:00",
  }),
  message("94", DIGEST),
  message(
    "95",
    '<a class="tgme_widget_message_author_name" href="https://t.me/hypnosisflow"><span dir="auto">hypnosisflow</span></a> pinned «<span class="tgme_widget_service_strong_text" dir="auto">https://hpnssflw.github.io</span>»',
    { service: true, time: "2026-09-30T14:51:59+00:00" },
  ),
].join("\n");

describe("decodeEntities", () => {
  it("decodes the named and numeric entities Telegram emits", () => {
    expect(decodeEntities("Google&#39;s &amp; &quot;x&quot; &lt;b&gt; a&nbsp;b &#x2014;")).toBe(
      "Google's & \"x\" <b> a b —",
    );
  });
});

describe("parseRecentPosts", () => {
  it("takes the last real post, skipping service messages", () => {
    expect(latest(PAGE)).toEqual({
      id: 94,
      url: "https://t.me/hypnosisflow/94",
      date: "2026-09-30T04:09:28+00:00",
      title: "Research digest — 2 items",
      links: [
        {
          text: "Launch HN: Vespper (YC F24) – SOTA Docx MCP",
          href: "https://www.vespper.com/blog/launching-vespper-docx-mcp",
        },
        { text: "KKKKhazix/AIHOT", href: "https://github.com/KKKKhazix/AIHOT?a=1&b=2" },
      ],
    });
  });

  it("uses the first non-empty line as the title, tags stripped", () => {
    const page = message("7", "<br/><i>Hello</i> <b>world</b> &amp; more<br/>second line");
    expect(latest(page)?.title).toBe("Hello world & more");
  });

  it("keeps only http(s) links", () => {
    const page = message(
      "8",
      'Title<br/><a href="javascript:alert(1)">bad</a> <a href="tg://resolve?domain=x">app</a> <a href="https://ok.example/">ok</a>',
    );
    expect(latest(page)?.links).toEqual([
      { text: "ok", href: "https://ok.example/" },
    ]);
  });

  it("is empty for a page with no usable post", () => {
    expect(parseRecentPosts("<html>nothing here</html>", "hypnosisflow", 5)).toEqual([]);
    const onlyService = message("9", "x pinned «y»", { service: true });
    expect(parseRecentPosts(onlyService, "hypnosisflow", 5)).toEqual([]);
  });

  it("ignores posts from another channel", () => {
    expect(parseRecentPosts(PAGE, "someoneelse", 5)).toEqual([]);
  });

  it("returns up to limit posts, newest first", () => {
    expect(parseRecentPosts(PAGE, "hypnosisflow", 5).map((p) => p.id)).toEqual([94, 93]);
    expect(parseRecentPosts(PAGE, "hypnosisflow", 1).map((p) => p.id)).toEqual([94]);
  });
});

describe("fetchRecentPosts", () => {
  it("reads the channel's public preview page", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(PAGE, { status: 200 })));
    const posts = await fetchRecentPosts("hypnosisflow", 5, fetchImpl);
    expect(posts.map((p) => p.id)).toEqual([94, 93]);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("https://t.me/s/hypnosisflow");
  });

  it("retries once, then gives up with no posts", async () => {
    const flaky = vi
      .fn()
      .mockRejectedValueOnce(new Error("ETIMEDOUT"))
      .mockImplementationOnce(() => Promise.resolve(new Response(PAGE, { status: 200 })));
    expect((await fetchRecentPosts("hypnosisflow", 5, flaky))[0]?.id).toBe(94);

    const down = vi.fn().mockRejectedValue(new Error("ETIMEDOUT"));
    expect(await fetchRecentPosts("hypnosisflow", 5, down)).toEqual([]);
    expect(down).toHaveBeenCalledTimes(2);

    const missing = vi.fn(() => Promise.resolve(new Response("", { status: 404 })));
    expect(await fetchRecentPosts("hypnosisflow", 5, missing)).toEqual([]);
  });
});
