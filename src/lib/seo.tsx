import React, { createContext, useContext, useEffect, useMemo } from "react";

type Ctx = {
  siteName: string;
  baseUrl?: string;
  titleTemplate?: (title: string) => string;
};

const SEOContext = createContext<Ctx>({
  siteName: "Stockwise",
  baseUrl: "https://stockwiseapp.com",
  titleTemplate: (t) => (t ? `${t} — Stockwise` : "Stockwise"),
});

export function SEOProvider({
  children,
  siteName = "Stockwise",
  baseUrl = "https://stockwiseapp.com",
}: {
  children: React.ReactNode;
  siteName?: string;
  baseUrl?: string;
}) {
  const value = useMemo<Ctx>(
    () => ({
      siteName,
      baseUrl,
      titleTemplate: (t: string) => (t ? `${t} — ${siteName}` : siteName),
    }),
    [siteName, baseUrl]
  );
  return <SEOContext.Provider value={value}>{children}</SEOContext.Provider>;
}

// ---------- helpers ----------
function ensureMetaByName(name: string, content?: string | null) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!content) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    el.setAttribute("data-managed", "seo");
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function ensureMetaByProp(property: string, content?: string | null) {
  let el = document.head.querySelector<HTMLMetaElement>(
    `meta[property="${property}"]`
  );
  if (!content) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("property", property);
    el.setAttribute("data-managed", "seo");
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function ensureCanonical(href?: string | null) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!href) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    el.setAttribute("data-managed", "seo");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function absolute(base: string | undefined, path?: string) {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  if (!base) return path;
  return new URL(path, base).toString();
}

export function SEO({
  title,
  description,
  image = "/og-cover.png",
  url,
  canonical,
  noindex,
}: {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  canonical?: string;
  noindex?: boolean;
}) {
  const { titleTemplate, baseUrl, siteName } = useContext(SEOContext);

  useEffect(() => {
    const fullTitle =
      titleTemplate?.(title ?? "") ?? title ?? siteName ?? "App";
    document.title = fullTitle;

    const absUrl =
      url ??
      (baseUrl
        ? new URL(window.location.pathname + window.location.search, baseUrl).toString()
        : undefined);
    const absImg = absolute(baseUrl, image);

    // basic
    ensureMetaByName("description", description ?? undefined);

    // og
    ensureMetaByProp("og:type", "website");
    ensureMetaByProp("og:site_name", siteName);
    ensureMetaByProp("og:title", fullTitle);
    ensureMetaByProp("og:description", description ?? undefined);
    ensureMetaByProp("og:url", absUrl);
    ensureMetaByProp("og:image", absImg);

    // twitter
    ensureMetaByName("twitter:card", "summary_large_image");
    ensureMetaByName("twitter:title", fullTitle);
    ensureMetaByName("twitter:description", description ?? undefined);
    ensureMetaByName("twitter:image", absImg);

    // robots + canonical
    ensureMetaByName("robots", noindex ? "noindex, nofollow" : "index, follow");
    ensureCanonical(canonical ?? absUrl);
  }, [title, description, image, url, canonical, noindex, titleTemplate, baseUrl, siteName]);

  return null;
}
