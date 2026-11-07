import { serveStatic } from "hono/bun";
import config from "./zosite.json";
import { Hono } from "hono";
import { dashboard, auditExport } from "./backend-lib/election";
import { Database } from 'bun:sqlite';
import { existsSync, readdirSync } from 'node:fs';
import { createTelemetry } from './backend-lib/telemetry';

// AI agents: read README.md for navigation and contribution guidance.
type Mode = "development" | "production";
const app = new Hono();
const telemetry = createTelemetry(new Database(new URL('./data/telemetry.sqlite', import.meta.url).pathname, { create: true }));
app.route('/api/t', telemetry.app);

/** The party room closed Nov 5 at 00:00 ET and is retired: comments, handles and picks are no longer served.
 *  Only the final per-race emoji counts remain, exported by scripts/export_reactions.ts. */
const finalDir = new URL('./data/final/', import.meta.url).pathname;
const reactionFile = existsSync(finalDir) ? readdirSync(finalDir).filter(f => /^reactions-\d{8}\.json$/.test(f)).sort().at(-1) : undefined;
const finalReactions = reactionFile ? await Bun.file(finalDir + reactionFile).json() : { schema: 'tow-reactions-v1', total: 0, counts: {} };
if (finalReactions.schema !== 'tow-reactions-v1' || typeof finalReactions.counts !== 'object') throw new Error(`Reaction counts file ${reactionFile} is not a valid tow-reactions-v1 record`);
app.get('/api/reactions', (c) => c.json(finalReactions));

const mode: Mode =
  process.env.NODE_ENV === "production" ? "production" : "development";

/**
 * Add any API routes here.
 */
app.get("/api/hello-zo", (c) => c.json({ msg: "Hello from Zo" }));
app.get('/api/election', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await dashboard());
});
app.get('/api/receipts', (c) => {
  c.header('Content-Disposition', 'attachment; filename="tired-of-winning-receipts.json"');
  c.header('Cache-Control', 'no-store');
  return c.json(auditExport());
});

configureProduction(app);

/**
 * Determine port based on mode. In production, use the published_port if available.
 * In development, always use the local_port.
 * Ports are managed by the system and injected via the PORT environment variable.
 */
const port = process.env.PORT
  ? parseInt(process.env.PORT, 10)
  : mode === "production"
    ? (config.publish?.published_port ?? config.local_port)
    : config.local_port;

export default { fetch: app.fetch, port, idleTimeout: 255 };

/**
 * Configure routing for production builds.
 *
 * - Streams prebuilt assets from `dist`.
 * - Static files from `public/` are copied to `dist/` by Vite and served at root paths.
 * - Falls back to `index.html` for any other GET so the SPA router can resolve the request.
 */
function configureProduction(app: Hono) {
  app.use("/assets/*", serveStatic({ root: "./dist" }));
  app.get("/favicon.ico", (c) => c.redirect("/favicon.svg", 302));
  app.use(async (c, next) => {
    if (c.req.method !== "GET") return next();

    const path = c.req.path;
    if (path.startsWith("/api/") || path.startsWith("/assets/")) return next();

    const file = Bun.file(`./dist${path}`);
    if (await file.exists()) {
      const stat = await file.stat();
      if (stat && !stat.isDirectory()) {
        return new Response(file);
      }
    }

    return serveStatic({ path: "./dist/index.html" })(c, next);
  });
}
