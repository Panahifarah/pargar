import type { MetadataRoute } from "next";

/** Keep certificate share URLs out of search indexes (unlisted-by-link). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: ["/c/", "/api/certificates/"],
    },
  };
}
