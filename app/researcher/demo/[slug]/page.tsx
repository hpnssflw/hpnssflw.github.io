import type { Metadata } from "next";
import DemoRoom from "@/components/DemoRoom";
import { TEXT } from "@/lib/control-room-text";
import { DEMO_SLUGS, loadDemo, presetLinks } from "@/lib/demo-presets";

export function generateStaticParams() {
  return DEMO_SLUGS.map((slug) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  // Reached from the preset switch on /researcher/queue/ and on each demo
  // page, and indexable (unlisted until 2026-10-12).
  const demo = loadDemo(slug);
  const { name, language } = demo.run1.preset;
  const description = TEXT[language].demo.description;
  return {
    title: name,
    description,
    openGraph: { title: name, description, type: "website", locale: language === "ru" ? "ru_RU" : "en_US" },
  };
}

export default async function DemoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Read from the committed demo goldens at build time (static export: once).
  return <DemoRoom demo={loadDemo(slug)} presets={presetLinks()} />;
}
