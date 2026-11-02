import Head from "next/head";
import { Fragment } from "react";

export interface SEOProps {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
}

// SEO elements that can be used in _document.tsx (returns JSX without Head wrapper)
export function SEOElements({
  title = "MindBet Pro",
  description = "Premium Sportsbook & Casino Platform",
  image = "/og-image.png",
  url = "https://mindbetpro.com",
}: SEOProps = {}) {
  return (
    <Fragment>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="application-name" content="MindBet Pro" />
      <meta name="apple-mobile-web-app-title" content="MindBet Pro" />
      
      <link rel="icon" type="image/svg+xml" href="/mindbetpro-icon.svg" />
      <link rel="apple-touch-icon" href="/mindbetpro-icon.svg" />
      <link rel="shortcut icon" href="/mindbetpro-icon.svg" />
      
      <title>{title}</title>
      <meta name="description" content={description} />
      
      <meta property="og:type" content="website" />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={image} />
      <meta property="og:site_name" content="MindBet Pro" />
      
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:url" content={url} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
    </Fragment>
  );
}

// SEO component for use in pages/_app.tsx or individual pages (uses next/head)
// Note: Flattened structure (no fragment) for better Next.js Head compatibility during hot reload
export function SEO({
  title = "MindBet Pro",
  description = "Premium Sportsbook & Casino Platform",
  image = "/og-image.png",
  url = "https://mindbetpro.com",
}: SEOProps = {}) {
  return (
    <Head>
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="application-name" content="MindBet Pro" />
      <meta name="apple-mobile-web-app-title" content="MindBet Pro" />
      
      <link rel="icon" type="image/svg+xml" href="/mindbetpro-icon.svg" />
      <link rel="apple-touch-icon" href="/mindbetpro-icon.svg" />
      <link rel="shortcut icon" href="/mindbetpro-icon.svg" />
      
      <meta property="og:type" content="website" />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={image} />
      <meta property="og:site_name" content="MindBet Pro" />
      
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:url" content={url} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
    </Head>
  );
}
