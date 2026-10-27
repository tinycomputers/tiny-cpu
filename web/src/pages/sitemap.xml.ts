import type { APIRoute } from "astro";

// Every page on the site. Add a page here when you add one under src/pages.
const PAGES = [
  "/",
  "/app/",
  "/docs/how-it-works/",
  "/docs/architecture/",
  "/docs/the-pipeline/",
  "/docs/hazards/",
  "/docs/verification/",
];

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL("https://tiny-cpu.vercel.app");
  const urls = PAGES.map((p) => `  <url><loc>${new URL(p, base).href}</loc></url>`).join("\n");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
};
