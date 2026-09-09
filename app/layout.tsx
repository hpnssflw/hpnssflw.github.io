import type { Metadata, Viewport } from "next";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import PageFrame from "@/components/PageFrame";

export const metadata: Metadata = {
  metadataBase: new URL("https://hpnssflw.github.io"),
  title: {
    default: "Artem Polozov — Digital Craftsman",
    template: "%s — Artem Polozov",
  },
  description:
    "Web products, data visualization, systems integration, AI agent orchestration.",
  openGraph: {
    title: "Artem Polozov — Digital Craftsman",
    description:
      "Web products, data visualization, systems integration, AI agent orchestration.",
    type: "website",
    url: "/",
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        <PageFrame>
          {children}
          <SiteFooter />
        </PageFrame>
      </body>
    </html>
  );
}
