import type { Metadata } from "next";
import { getPost, getPostSlugs } from "@/lib/posts";

export function generateStaticParams() {
  return getPostSlugs().map((slug) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  return {
    title: post.title,
    description: post.description,
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
    },
  };
}

export default async function PostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPost(slug);
  const { default: Body } = await import(`@/content/lab/${slug}.mdx`);

  return (
    <article className="post">
      <div className="wrap">
        <p className="meta">
          <span className="mono date">{post.dateLabel}</span>
          <span className="mono sep">·</span>
          <span className="mono tag">{post.tag}</span>
        </p>
        <h1>{post.title}</h1>
        <p className="subtitle">{post.subtitle}</p>
        <div className="body">
          <Body />
        </div>
      </div>
    </article>
  );
}
