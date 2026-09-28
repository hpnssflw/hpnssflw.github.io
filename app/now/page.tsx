import type { Metadata } from "next";
import NowMusic from "@/components/NowMusic";

const description =
  "What Artem Polozov is listening to, and whether he's in Claude Code right now.";

export const metadata: Metadata = {
  title: "Now",
  description,
  openGraph: { title: "Now", description, type: "website" },
};

// Static shell only — every block's data is client-fetched from the
// presence-data branch, which Artem's machine publishes.
export default function NowPage() {
  return (
    <section id="now">
      <div className="wrap">
        <h1 className="section-label">Now</h1>

        <section className="now-block" aria-labelledby="now-music">
          <h2 className="now-label" id="now-music">
            Music
          </h2>
          <NowMusic />
        </section>

        <section className="now-block" aria-labelledby="now-games">
          <h2 className="now-label" id="now-games">
            Games
          </h2>
          <p className="now-upcoming">
            upcoming — yandex games, once there&apos;s something worth showing
          </p>
        </section>
      </div>
    </section>
  );
}
