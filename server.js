// server.js (ESM) — drop-in vervanger

import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { createMollieClient } from "@mollie/api-client";

// ==== Config ====
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;  // gebruikt voor redirect & webhook
const FRONTEND_URL = process.env.FRONTEND_URL || `http://localhost:${PORT}`;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const MOLLIE_API_KEY = (process.env.MOLLIE_API_KEY || "").trim();

console.log("Mollie key loaded?", MOLLIE_API_KEY ? "yes" : "no");
console.log("BASE_URL:", BASE_URL, "PORT:", PORT);

if (!MOLLIE_API_KEY) {
  console.warn("MOLLIE_API_KEY ontbreekt. Zet deze in je .env voordat je betalingen maakt.");
}

// ==== Mollie client ====
const mollie = MOLLIE_API_KEY ? createMollieClient({ apiKey: MOLLIE_API_KEY }) : null;

const requireMollie = (res) => {
  if (mollie && (MOLLIE_API_KEY.startsWith("test_") || MOLLIE_API_KEY.startsWith("live_"))) return true;
  if (mollie) {
    res.status(503).json({
      ok: false,
      error: "Mollie key is ongeldig ingesteld",
      detail: "De MOLLIE_API_KEY in Render moet exact beginnen met test_ of live_, zonder Bearer, zonder MOLLIE_API_KEY= en zonder spaties.",
    });
    return false;
  }
  res.status(503).json({ ok: false, error: "Mollie is not configured" });
  return false;
};

const isLocalUrl = (url) => {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return true;
  }
};

const addWebhookUrlWhenPublic = (paymentConfig, webhookPath) => {
  if (!isLocalUrl(BASE_URL)) {
    paymentConfig.webhookUrl = `${BASE_URL}${webhookPath}`;
  }
  return paymentConfig;
};

const getFrontendReturnUrl = (plan) => {
  const params = new URLSearchParams({ paid: "1", download: "1" });
  if (plan) params.set("plan", plan);
  return `${FRONTEND_URL}/?${params.toString()}`;
};

// ==== Express app ====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // nodig omdat Mollie x-www-form-urlencoded kan posten
app.use(express.static(path.join(__dirname, "public"))); // serveert /public

// ==== Basispagina's ====
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "corenova-backend",
    routes: [
      "GET /",
      "GET /health",
      "POST /api/pay",
      "POST /api/sos",
      "POST /api/subscribe",
      "POST /mollie/create-payment",
      "GET /mollie/return",
      "POST /mollie/webhook",
    ],
  });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

// ==== SOS voorbeeld (zoals in jouw versie) ====
app.post("/api/sos", (req, res) => {
  const payload = {
    id: randomUUID(),
    at: new Date().toISOString(),
    event: req.body?.event || "sos",
    coords: req.body?.coords ?? null,
    contacts: Array.isArray(req.body?.contacts) ? req.body.contacts : [],
    lang: req.body?.lang || "nl",
    userAgent: req.headers["user-agent"] || "",
    note: req.body?.note || "",
  };
  console.log("🔥 SOS binnen:", payload);
  res.json({ ok: true, id: payload.id });
});

app.post("/api/subscribe", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 120);
  const source = String(req.body?.source || "unknown").trim().slice(0, 40);

  if (!email || !email.includes("@")) {
    return res.status(400).json({ ok: false, error: "Invalid email" });
  }

  console.log("📩 Update-inschrijving:", {
    id: randomUUID(),
    at: new Date().toISOString(),
    email,
    source,
  });

  res.json({ ok: true });
});

// ==== PLANS voor /api/pay ====
const PLANS = {
  oneoff7:  { value: "7.00", currency: "EUR", description: "GuardTap Basis toegang - eenmalig EUR 7" },
  premium5: { value: "5.00", currency: "EUR", description: "GuardTap Premium toegang - EUR 5 per maand" },
};

// ==== /api/pay — twee knoppen ($7 / $5) ====
app.post("/api/pay", async (req, res) => {
  try {
    if (!requireMollie(res)) return;

    const { plan } = req.body || {};
    const referrer = String(req.body?.referrer || "").trim().replace(/[^a-zA-Z0-9-]/g, "").slice(0, 32);
    const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 120);
    console.log("[/api/pay] body:", req.body, "BASE_URL:", BASE_URL);

    const cfg = PLANS[plan];
    if (!cfg) {
      console.error("[/api/pay] Unknown plan:", plan, "expected:", Object.keys(PLANS));
      return res.status(400).json({ error: "Unknown plan", expected: Object.keys(PLANS) });
    }

    const paymentConfig = addWebhookUrlWhenPublic({
      amount: { currency: cfg.currency, value: cfg.value },
      description: cfg.description,
      redirectUrl: getFrontendReturnUrl(plan),
      metadata: { plan, referrer: referrer || null, email: email || null },
    }, "/api/webhook");

    const payment = await mollie.payments.create(paymentConfig);

    console.log("✅ Created payment:", payment.id, payment.getCheckoutUrl(), "plan:", plan);
    console.log("↩️  Webhook:", paymentConfig.webhookUrl || "skipped for local development");
    return res.json({ id: payment.id, checkoutUrl: payment.getCheckoutUrl() });
  } catch (err) {
    const body = err?.response?.body;
    console.error(
      "[/api/pay] ERROR:",
      "\n statusCode:", err?.statusCode,
      "\n title:", err?.title,
      "\n detail:", body?.detail,
      "\n code:", body?.code,
      "\n full:", body || err
    );
    return res.status(err?.statusCode || 500).json({
      error: "Failed creating payment",
      detail: body?.detail || err?.message,
      code: body?.code,
    });
  }
});

// ==== /mollie/create-payment — enkel voorbeeld (maand €7) ====
app.post("/mollie/create-payment", async (_req, res) => {
  try {
    if (!requireMollie(res)) return;

    const paymentConfig = addWebhookUrlWhenPublic({
      amount: { value: "7.00", currency: "EUR" },
      description: "CoreNova Premium (maand)",
      redirectUrl: getFrontendReturnUrl("premium-monthly"),
      metadata: { plan: "premium-monthly", user: "anon", source: "landing" },
      // method: ["ideal","creditcard"], // desgewenst forceren
    }, "/mollie/webhook");

    const payment = await mollie.payments.create(paymentConfig);

    console.log("✅ Created payment:", payment.id, payment.getCheckoutUrl(), "meta:", payment.metadata);
    res.json({ ok: true, id: payment.id, checkoutUrl: payment.getCheckoutUrl() });
  } catch (e) {
    const body = e?.response?.body;
    console.error(
      "Mollie create-payment error:",
      "\n statusCode:", e?.statusCode,
      "\n title:", e?.title,
      "\n detail:", body?.detail,
      "\n code:", body?.code,
      "\n full:", body || e
    );
    res.status(500).json({ ok: false, error: body?.detail || e.message });
  }
});

// ==== Terugkeer na betaling (stuurt door naar je frontend/PWA) ====
app.get("/mollie/return", (_req, res) => {
  const back = getFrontendReturnUrl("premium-monthly");
  return res.redirect(back);
});

// ==== Webhooks ====
// Let op: Mollie post meestal application/x-www-form-urlencoded; express.urlencoded staat aan.
app.post("/api/webhook", async (req, res) => {
  try {
    if (!mollie) return res.status(200).end();

    console.log("[/api/webhook] HIT", new Date().toISOString(), "body:", req.body, "query:", req.query);
    const paymentId = req.body?.id || req.query?.id;
    if (!paymentId) {
      console.warn("[/api/webhook] No payment id in request");
      return res.status(200).end();
    }
    const p = await mollie.payments.get(paymentId);
    console.log("🧾 Payment status:", p.id, p.status, "plan:", p.metadata?.plan);
    // TODO: wanneer p.status === "paid": activeer premium in je DB
    return res.status(200).end(); // Mollie verwacht 200
  } catch (e) {
    console.error("[/api/webhook] ERROR:", e?.response?.body || e);
    return res.status(200).end(); // alsnog 200: geen eindeloze retries
  }
});

// Alternatieve webhook route (voor je /mollie/* voorbeeld)
app.post("/mollie/webhook", async (req, res) => {
  try {
    if (!mollie) return res.status(200).end();

    console.log("[/mollie/webhook] HIT", new Date().toISOString(), "body:", req.body, "query:", req.query);
    const paymentId = req.body?.id || req.query?.id;
    if (!paymentId) return res.status(200).end();
    const p = await mollie.payments.get(paymentId);
    console.log("🧾 Payment status:", p.id, p.status, "meta:", p.metadata);
    return res.status(200).end();
  } catch (e) {
    console.error("[/mollie/webhook] ERROR:", e?.response?.body || e);
    return res.status(200).end();
  }
});

// ==== Start server ====
app.listen(PORT, () => {
  console.log(`CoreNova server running on ${BASE_URL} (port ${PORT})`);
});
