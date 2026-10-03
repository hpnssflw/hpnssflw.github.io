/**
 * Recent posts from the public channel the research agent publishes to,
 * shown in the home LAB card next to LAB posts. Read once per `next build`
 * from the channel's public preview (t.me/s/<channel> — plain HTML, no
 * token; the browser can't fetch it cross-origin), so they're as fresh as
 * the last deploy, which deploy.yml repeats every 6 hours.
 *
 * Telegram's markup isn't an API: anything unexpected is skipped, and a
 * page that yields nothing just means no Telegram slides. Post text is
 * reduced to plain strings and http(s) links — never injected as HTML.
 */

export const TELEGRAM_CHANNEL = "hypnosisflow";

export interface PostLink {
  text: string;
  href: string;
}

export interface TelegramPost {
  id: number;
  url: string;
  date: string; // ISO 8601, from the post's <time datetime>
  title: string; // first non-empty line
  links: PostLink[];
}

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

function plain(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

/** Up to `limit` non-service posts of `channel` on its t.me/s page, newest first. */
export function parseRecentPosts(html: string, channel: string, limit: number): TelegramPost[] {
  const posts: TelegramPost[] = [];
  const chunks = html.split('class="tgme_widget_message_wrap').slice(1);
  for (const chunk of chunks.reverse()) {
    if (posts.length >= limit) break;
    if (/class="tgme_widget_message[^"]*\bservice_message\b/.test(chunk)) continue;

    const post = chunk.match(/data-post="([^"/]+)\/(\d+)"/);
    if (!post || post[1].toLowerCase() !== channel.toLowerCase()) continue;
    const time = chunk.match(/<time datetime="([^"]+)"/);
    const body = chunk.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (!time || Number.isNaN(Date.parse(time[1])) || !body) continue;

    const title = body[1].split(/<br\s*\/?>/i).map(plain).find((line) => line !== "") ?? "";
    const links: PostLink[] = [];
    for (const a of body[1].matchAll(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = decodeEntities(a[1]);
      const text = plain(a[2]);
      if (/^https?:\/\//i.test(href) && text) links.push({ text, href });
    }
    if (!title && links.length === 0) continue;

    const id = Number(post[2]);
    posts.push({ id, url: `https://t.me/${channel}/${id}`, date: time[1], title, links });
  }
  return posts;
}

/**
 * Build-time only. Empty — no Telegram slides — on a non-200 or after a
 * second network failure (t.me may be unreachable from a dev machine); it
 * must never fail the deploy.
 */
export async function fetchRecentPosts(
  channel: string,
  limit: number,
  fetchImpl: typeof fetch = fetch,
): Promise<TelegramPost[]> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetchImpl(`https://t.me/s/${channel}`, {
        headers: { "User-Agent": "Mozilla/5.0 (hpnssflw.github.io build)" },
      });
      if (!res.ok) {
        console.warn(`[telegram-post] t.me answered ${res.status}; no Telegram posts`);
        return [];
      }
      const posts = parseRecentPosts(await res.text(), channel, limit);
      if (posts.length === 0) console.warn("[telegram-post] no posts found on the page");
      return posts;
    } catch (err) {
      if (attempt === 2) console.warn(`[telegram-post] ${String(err)}; no Telegram posts`);
    }
  }
  return [];
}
