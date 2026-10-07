import type { Metadata } from "next";
import DemoRoom from "@/components/DemoRoom";
import { DEMO_SLUGS, demoLinks, loadDemo } from "@/lib/demo-presets";

export function generateStaticParams() {
  return DEMO_SLUGS.map((slug) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  // Unlisted: Artem sends the link to prospective clients; nothing links
  // here and search engines are asked to stay out.
  return { title: loadDemo(slug).run1.preset.name, robots: { index: false, follow: false } };
}

export default async function DemoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Read from the committed demo goldens at build time (static export: once).
  return <DemoRoom demo={loadDemo(slug)} presets={demoLinks()} />;
}
