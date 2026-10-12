import type { RouterClient } from "@orpc/server";
import { createApp } from "./__core/app";
import { auth } from "./auth";
import { ingestOrders } from "./lib/ingest";
import { getSettings } from "./lib/settings";
import { parseJsonOrder, parseWooOrdersCsv } from "./lib/woo";
import { billing } from "./routes/billing";
import { broilers } from "./routes/broilers";
import { combinedBilling } from "./routes/combined-billing";
import { customers } from "./routes/customers";
import { dashboard } from "./routes/dashboard";
import { layers } from "./routes/layers";
import { lists } from "./routes/lists";
import { orders } from "./routes/orders";
import { ping } from "./routes/ping";
import { products } from "./routes/products";
import { settings } from "./routes/settings";
import { subscriptions } from "./routes/subscriptions";
import { timesheets } from "./routes/timesheets";

export const router = {
  ping,
  dashboard,
  products,
  customers,
  orders,
  subscriptions,
  billing: { ...billing, ...combinedBilling },
  broilers,
  layers,
  lists,
  timesheets,
  settings,
};

export type AppRouter = typeof router;
/** Typed client for the router — used by the web and mobile api clients. */
export type AppRouterClient = RouterClient<AppRouter>;

const app = createApp(router);
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

/**
 * Automatic website sync. Accepts either a single WooCommerce order JSON payload,
 * `{ orders: [...] }`, or `{ csv: "..." }`. Authenticated with the app's API key
 * (Settings page) via the `x-api-key` header or `?key=` query param.
 */
app.post("/api/ingest/orders", async (c) => {
  const s = await getSettings();
  const key = c.req.header("x-api-key") ?? new URL(c.req.url).searchParams.get("key") ?? "";
  if (!s.apiKey || key !== s.apiKey) {
    return c.json({ error: "Invalid API key" }, 401);
  }

  let payload: unknown;
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("text/csv")) {
    payload = { csv: await c.req.text() };
  } else {
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "Body must be JSON or text/csv" }, 400);
    }
  }

  const body = payload as Record<string, unknown>;
  if (typeof body.csv === "string") {
    const parsed = parseWooOrdersCsv(body.csv);
    if (parsed.length === 0) return c.json({ error: "No orders found in CSV" }, 400);
    return c.json(await ingestOrders(parsed, "api"), 200);
  }

  const raw = Array.isArray(body.orders) ? (body.orders as Record<string, unknown>[]) : [body];
  const parsed = raw
    .map((o) => parseJsonOrder(o))
    .filter((o): o is NonNullable<typeof o> => o !== null);
  if (parsed.length === 0) return c.json({ error: "No usable orders in payload" }, 400);
  return c.json(await ingestOrders(parsed, "api"), 200);
});

export default app;
