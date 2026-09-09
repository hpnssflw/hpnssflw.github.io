import createMDX from "@next/mdx";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  pageExtensions: ["ts", "tsx", "js", "jsx", "md", "mdx"],
};

const withMDX = createMDX({
  // String form so the plugin is usable under Turbopack.
  options: {
    remarkPlugins: [["remark-frontmatter", { type: "yaml", marker: "-" }]],
  },
});

export default withMDX(nextConfig);
