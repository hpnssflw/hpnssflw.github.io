import type { Metadata } from "next";
import DemoRoom from "@/components/DemoRoom";
import { TEXT } from "@/lib/control-room-text";
import { DEMO_SLUGS, demoLinks, loadDemo } from "@/lib/demo-presets";

export function generateStaticParams() {
  return DEMO_SLUGS.map((slug) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  // Unlisted: Artem sends the link to prospective clients; nothing links
  // here and search engines are asked to stay out.
  const demo = loadDemo(slug);
  const { name, language } = demo.run1.preset;
  const description = TEXT[language].demo.description;
  return {
    title: name,
    description,
    robots: { index: false, follow: false },
    openGraph: { title: name, description, type: "website", locale: language === "ru" ? "ru_RU" : "en_US" },
  };
}

export default async function DemoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Read from the committed demo goldens at build time (static export: once).
  return <DemoRoom demo={loadDemo(slug)} presets={demoLinks()} />;
}
