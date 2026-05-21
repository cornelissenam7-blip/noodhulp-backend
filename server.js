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
const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const ADMIN_KEY = (process.env.ADMIN_KEY || "").trim();

console.log("Mollie key loaded?", MOLLIE_API_KEY ? "yes" : "no");
console.log("BASE_URL:", BASE_URL, "PORT:", PORT);
console.log("Supabase loaded?", SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? "yes" : "no");

if (!MOLLIE_API_KEY) {
  console.warn("MOLLIE_API_KEY ontbreekt. Zet deze in je .env voordat je betalingen maakt.");
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("Supabase is nog niet gekoppeld. Referralgegevens worden nu alleen gelogd.");
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

const hasDatabase = () => Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

async function supabaseRequest(table, { method = "POST", query = "", body = null, prefer = "" } = {}) {
  if (!hasDatabase()) return null;

  const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
  const response = await fetch(url, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase ${table} ${method} failed: ${response.status} ${text}`);
  }

  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

async function upsertRecord(table, row, conflictColumn) {
  if (!hasDatabase()) {
    console.log(`[db-off] ${table}:`, row);
    return null;
  }

  try {
    return await supabaseRequest(table, {
      method: "POST",
      query: `?on_conflict=${encodeURIComponent(conflictColumn)}`,
      body: row,
      prefer: "resolution=merge-duplicates,return=representation",
    });
  } catch (error) {
    console.error(`[db] ${table} opslaan mislukt:`, error.message);
    return null;
  }
}

function getCommissionValue(plan) {
  if (plan === "oneoff7") return "3.50";
  if (plan === "premium5") return "2.50";
  return "0.00";
}

async function recordPayment(payment, { checkoutUrl = "" } = {}) {
  const metadata = payment.metadata || {};
  const plan = metadata.plan || "unknown";
  const referrer = metadata.referrer || null;
  const email = metadata.email || null;
  const amount = payment.amount || {};

  await upsertRecord("guardtap_payments", {
    mollie_payment_id: payment.id,
    plan,
    status: payment.status || "open",
    amount_value: amount.value || null,
    amount_currency: amount.currency || "EUR",
    email,
    phone: metadata.phone || null,
    referrer_code: referrer,
    customer_id: metadata.customerId || payment.customerId || null,
    subscription_id: payment.subscriptionId || metadata.subscriptionId || null,
    checkout_url: checkoutUrl || payment.getCheckoutUrl?.() || null,
    metadata,
    updated_at: new Date().toISOString(),
  }, "mollie_payment_id");

  if (payment.status === "paid" && referrer) {
    await upsertRecord("guardtap_referral_commissions", {
      mollie_payment_id: payment.id,
      referrer_code: referrer,
      buyer_email: email,
      plan,
      commission_value: getCommissionValue(plan),
      commission_currency: "EUR",
      status: "pending",
      updated_at: new Date().toISOString(),
    }, "mollie_payment_id");
  }
}

function buildPayoutOverview(payments = [], commissions = []) {
  const ownersByCode = new Map();

  for (const payment of payments || []) {
    const metadata = payment.metadata || {};
    const code = cleanReferralCode(metadata.buyerReferralCode || "");
    if (!code || payment.status !== "paid") continue;
    if (!ownersByCode.has(code)) {
      ownersByCode.set(code, {
        code,
        email: payment.email || metadata.email || "",
        phone: payment.phone || metadata.phone || "",
        iban: metadata.iban || "",
        sourcePaymentId: payment.mollie_payment_id || "",
      });
    }
  }

  const grouped = new Map();
  for (const row of commissions || []) {
    if (row.status !== "pending") continue;
    const code = cleanReferralCode(row.referrer_code || "");
    if (!code) continue;

    const current = grouped.get(code) || {
      code,
      email: "",
      phone: "",
      iban: "",
      count: 0,
      total: 0,
      currency: row.commission_currency || "EUR",
      status: "pending",
      note: "",
    };

    current.count += 1;
    current.total += Number(row.commission_value || 0);
    grouped.set(code, current);
  }

  return Array.from(grouped.values())
    .map((row) => {
      const owner = ownersByCode.get(row.code) || {};
      const iban = owner.iban || row.iban || "";
      return {
        ...row,
        email: owner.email || "",
        phone: owner.phone || "",
        iban,
        total: row.total.toFixed(2),
        ready: Boolean(iban),
        note: iban ? "Klaar voor bankexport" : "IBAN ontbreekt nog",
      };
    })
    .sort((a, b) => Number(b.total) - Number(a.total));
}

function addAffiliateDataToPayouts(payouts = [], affiliates = []) {
  const affiliatesByCode = new Map(
    (affiliates || []).map((affiliate) => [cleanReferralCode(affiliate.referral_code || ""), affiliate])
  );

  return (payouts || []).map((row) => {
    const affiliate = affiliatesByCode.get(row.code);
    if (!affiliate) return row;
    const iban = affiliate.iban || "";
    return {
      ...row,
      name: affiliate.name || "",
      email: affiliate.email || row.email || "",
      phone: affiliate.phone || row.phone || "",
      iban,
      ready: Boolean(iban && affiliate.accepted_terms && affiliate.status === "active"),
      note: iban && affiliate.accepted_terms && affiliate.status === "active"
        ? "Klaar voor bankexport"
        : "Gegevens nog niet compleet",
    };
  });
}

function cleanReferralCode(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9-]/g, "").slice(0, 32);
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 120);
}

function cleanPhone(value) {
  return String(value || "").trim().replace(/[^\d+()\-\s]/g, "").slice(0, 40);
}

function isValidEmail(value) {
  const email = cleanEmail(value);
  return Boolean(email && email.includes("@") && email.includes("."));
}

function isValidPhone(value) {
  return cleanPhone(value).replace(/\D/g, "").length >= 8;
}

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function cleanIban(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9]/g, "").slice(0, 34);
}

function isValidIban(value) {
  const iban = cleanIban(value);
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban);
}

function cleanText(value, maxLength = 300) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function cleanSlug(value, maxLength = 80) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
}

function cleanUrl(value) {
  const raw = String(value || "").trim().slice(0, 500);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

const getFrontendReturnUrl = (plan, buyerReferralCode = "") => {
  const params = new URLSearchParams({ paid: "1", download: "1" });
  if (plan) params.set("plan", plan);
  if (buyerReferralCode) params.set("myref", buyerReferralCode);
  return `${FRONTEND_URL}/?${params.toString()}`;
};

// ==== Express app ====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const allowedOrigins = CORS_ORIGIN === "*"
  ? "*"
  : CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (allowedOrigins === "*" || !origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
}));
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
      "GET /debug/config",
    "GET /api/admin/overview",
      "GET /api/campaign",
      "POST /api/admin/campaign",
      "GET /api/agent/overview",
      "POST /api/agent/track",
      "POST /api/agent/lead",
      "POST /api/pay",
      "POST /api/sos",
      "POST /api/subscribe",
      "POST /api/affiliate-payout",
      "GET /api/referrals/:code",
      "POST /api/subscription-webhook",
      "POST /mollie/create-payment",
      "GET /mollie/return",
      "POST /mollie/webhook",
    ],
  });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/debug/config", (_req, res) => {
  res.json({
    ok: true,
    mollie: Boolean(MOLLIE_API_KEY && MOLLIE_API_KEY.startsWith("live_")),
    mollieMode: MOLLIE_API_KEY.startsWith("live_") ? "live" : MOLLIE_API_KEY.startsWith("test_") ? "test" : "missing",
    supabase: hasDatabase(),
    baseUrl: BASE_URL,
    frontendUrl: FRONTEND_URL,
  });
});

function hasAdminAccess(req) {
  const supplied = String(req.query?.key || req.headers["x-admin-key"] || "").trim();
  return Boolean(ADMIN_KEY && supplied && supplied === ADMIN_KEY);
}

app.get("/api/admin/overview", async (req, res) => {
  if (!hasAdminAccess(req)) {
    return res.status(401).json({ ok: false, error: "Admincode klopt niet" });
  }

  if (!hasDatabase()) {
    return res.status(503).json({ ok: false, error: "Supabase is niet gekoppeld" });
  }

  try {
    const [payments, commissions, subscribers, affiliates, campaigns] = await Promise.all([
      supabaseRequest("guardtap_payments", {
        method: "GET",
        query: "?select=*&order=created_at.desc&limit=500",
      }),
      supabaseRequest("guardtap_referral_commissions", {
        method: "GET",
        query: "?select=*&order=created_at.desc&limit=500",
      }),
      supabaseRequest("guardtap_email_subscribers", {
        method: "GET",
        query: "?select=*&order=created_at.desc&limit=500",
      }),
      supabaseRequest("guardtap_affiliates", {
        method: "GET",
        query: "?select=*&order=created_at.desc&limit=500",
      }).catch((error) => {
        console.warn("[admin] Affiliates nog niet beschikbaar:", error.message);
        return [];
      }),
      supabaseRequest("guardtap_campaigns", {
        method: "GET",
        query: "?select=*&order=updated_at.desc&limit=20",
      }).catch((error) => {
        console.warn("[admin] Campaigns nog niet beschikbaar:", error.message);
        return [];
      }),
    ]);

    const paidPayments = (payments || []).filter((row) => row.status === "paid");
    const pendingCommissions = (commissions || []).filter((row) => row.status === "pending");
    const pendingTotal = pendingCommissions.reduce((sum, row) => sum + Number(row.commission_value || 0), 0);
    const payouts = addAffiliateDataToPayouts(buildPayoutOverview(payments || [], commissions || []), affiliates || []);
    const readyPayouts = payouts.filter((row) => row.ready);
    const readyPayoutTotal = readyPayouts.reduce((sum, row) => sum + Number(row.total || 0), 0);

    return res.json({
      ok: true,
      summary: {
        payments: payments?.length || 0,
        paidPayments: paidPayments.length,
        commissions: commissions?.length || 0,
        pendingCommissions: pendingCommissions.length,
        pendingTotal: pendingTotal.toFixed(2),
        payoutAffiliates: payouts.length,
        readyPayouts: readyPayouts.length,
        readyPayoutTotal: readyPayoutTotal.toFixed(2),
        subscribers: subscribers?.length || 0,
      },
      payments: payments || [],
      commissions: commissions || [],
      payouts,
      affiliates: affiliates || [],
      campaigns: campaigns || [],
      campaign: (campaigns || []).find((row) => row.active) || (campaigns || [])[0] || null,
      subscribers: subscribers || [],
    });
  } catch (error) {
    console.error("[/api/admin/overview] ERROR:", error.message);
    return res.status(500).json({ ok: false, error: "Admingegevens ophalen mislukt" });
  }
});

app.get("/api/campaign", async (_req, res) => {
  if (!hasDatabase()) {
    return res.json({ ok: true, campaign: null });
  }

  try {
    const rows = await supabaseRequest("guardtap_campaigns", {
      method: "GET",
      query: "?active=eq.true&select=*&order=updated_at.desc&limit=1",
    });
    return res.json({ ok: true, campaign: rows?.[0] || null });
  } catch (error) {
    console.warn("[/api/campaign] Geen campagne beschikbaar:", error.message);
    return res.json({ ok: true, campaign: null });
  }
});

app.post("/api/admin/campaign", async (req, res) => {
  if (!hasAdminAccess(req)) {
    return res.status(401).json({ ok: false, error: "Admincode klopt niet" });
  }

  const title = cleanText(req.body?.title, 80);
  const body = cleanText(req.body?.body, 260);
  const buttonText = cleanText(req.body?.buttonText, 40);
  const buttonUrl = cleanUrl(req.body?.buttonUrl);
  const active = req.body?.active !== false;

  if (!title || !body) {
    return res.status(400).json({ ok: false, error: "Titel en tekst zijn verplicht." });
  }

  if (buttonText && !buttonUrl) {
    return res.status(400).json({ ok: false, error: "Gebruik een geldige link met https:// als je een knop gebruikt." });
  }

  const saved = await upsertRecord("guardtap_campaigns", {
    campaign_id: "main",
    title,
    body,
    button_text: buttonText || null,
    button_url: buttonUrl || null,
    active,
    updated_at: new Date().toISOString(),
  }, "campaign_id");

  if (!saved) {
    return res.status(500).json({ ok: false, error: "Campagne opslaan mislukt." });
  }

  return res.json({ ok: true, campaign: saved?.[0] || null });
});

app.post("/api/agent/track", async (req, res) => {
  const site = cleanSlug(req.body?.site || req.query?.site || "unknown");
  const source = cleanSlug(req.body?.source || req.query?.utm_source || req.body?.utm_source || "direct");
  const medium = cleanSlug(req.body?.medium || req.query?.utm_medium || req.body?.utm_medium || "unknown");
  const campaign = cleanSlug(req.body?.campaign || req.query?.utm_campaign || req.body?.utm_campaign || "unknown");
  const pageUrl = cleanUrl(req.body?.pageUrl || req.headers.referer || "");
  const referrer = cleanUrl(req.body?.referrer || "");

  const eventId = randomUUID();
  const row = {
    event_id: eventId,
    site,
    event_type: "visit",
    source,
    medium,
    campaign,
    page_url: pageUrl || null,
    referrer: referrer || null,
    user_agent: cleanText(req.headers["user-agent"] || "", 300),
    metadata: req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {},
    created_at: new Date().toISOString(),
  };

  if (hasDatabase()) {
    try {
      await supabaseRequest("corenova_campaign_events", {
        method: "POST",
        body: row,
        prefer: "return=minimal",
      });
    } catch (error) {
      console.error("[/api/agent/track] Opslaan mislukt:", error.message);
    }
  } else {
    console.log("[agent-track]", row);
  }

  return res.json({ ok: true, eventId });
});

app.post("/api/agent/lead", async (req, res) => {
  const site = cleanSlug(req.body?.site || "unknown");
  const source = cleanSlug(req.body?.source || req.body?.utm_source || "direct");
  const medium = cleanSlug(req.body?.medium || req.body?.utm_medium || "unknown");
  const campaign = cleanSlug(req.body?.campaign || req.body?.utm_campaign || "unknown");
  const name = cleanName(req.body?.name || "");
  const email = cleanEmail(req.body?.email || "");
  const phone = cleanPhone(req.body?.phone || "");
  const message = cleanText(req.body?.message || "", 1000);

  if (!email && !phone) {
    return res.status(400).json({ ok: false, error: "E-mail of telefoon is verplicht." });
  }

  const leadId = randomUUID();
  const row = {
    lead_id: leadId,
    site,
    source,
    medium,
    campaign,
    name: name || null,
    email: email || null,
    phone: phone || null,
    message: message || null,
    status: "new",
    metadata: req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (hasDatabase()) {
    try {
      await supabaseRequest("corenova_campaign_leads", {
        method: "POST",
        body: row,
        prefer: "return=minimal",
      });
    } catch (error) {
      console.error("[/api/agent/lead] Opslaan mislukt:", error.message);
      return res.status(500).json({ ok: false, error: "Lead opslaan mislukt." });
    }
  } else {
    console.log("[agent-lead]", row);
  }

  return res.json({ ok: true, leadId });
});

app.get("/api/agent/overview", async (req, res) => {
  if (!hasAdminAccess(req)) {
    return res.status(401).json({ ok: false, error: "Admincode klopt niet" });
  }

  if (!hasDatabase()) {
    return res.status(503).json({ ok: false, error: "Supabase is niet gekoppeld" });
  }

  try {
    const [events, leads] = await Promise.all([
      supabaseRequest("corenova_campaign_events", {
        method: "GET",
        query: "?select=*&order=created_at.desc&limit=1000",
      }).catch((error) => {
        console.warn("[agent] Events nog niet beschikbaar:", error.message);
        return [];
      }),
      supabaseRequest("corenova_campaign_leads", {
        method: "GET",
        query: "?select=*&order=created_at.desc&limit=1000",
      }).catch((error) => {
        console.warn("[agent] Leads nog niet beschikbaar:", error.message);
        return [];
      }),
    ]);

    const grouped = new Map();
    for (const event of events || []) {
      const key = `${event.site || "unknown"}|${event.campaign || "unknown"}`;
      const current = grouped.get(key) || {
        site: event.site || "unknown",
        campaign: event.campaign || "unknown",
        visits: 0,
        leads: 0,
        source: event.source || "",
        medium: event.medium || "",
      };
      current.visits += 1;
      grouped.set(key, current);
    }

    for (const lead of leads || []) {
      const key = `${lead.site || "unknown"}|${lead.campaign || "unknown"}`;
      const current = grouped.get(key) || {
        site: lead.site || "unknown",
        campaign: lead.campaign || "unknown",
        visits: 0,
        leads: 0,
        source: lead.source || "",
        medium: lead.medium || "",
      };
      current.leads += 1;
      grouped.set(key, current);
    }

    const campaigns = Array.from(grouped.values()).sort((a, b) => b.leads - a.leads || b.visits - a.visits);

    return res.json({
      ok: true,
      summary: {
        visits: events?.length || 0,
        leads: leads?.length || 0,
        campaigns: campaigns.length,
      },
      campaigns,
      recentLeads: (leads || []).slice(0, 50),
      recentEvents: (events || []).slice(0, 50),
    });
  } catch (error) {
    console.error("[/api/agent/overview] ERROR:", error.message);
    return res.status(500).json({ ok: false, error: "Agentoverzicht ophalen mislukt" });
  }
});

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
  const email = cleanEmail(req.body?.email);
  const phone = cleanPhone(req.body?.phone);
  const source = String(req.body?.source || "unknown").trim().slice(0, 40);

  if (!isValidEmail(email) || !isValidPhone(phone)) {
    return res.status(400).json({ ok: false, error: "Email and phone are required" });
  }

  console.log("📩 Update-inschrijving:", {
    id: randomUUID(),
    at: new Date().toISOString(),
    email,
    phone,
    source,
  });

  upsertRecord("guardtap_email_subscribers", {
    email,
    phone,
    source,
    updated_at: new Date().toISOString(),
  }, "email");

  res.json({ ok: true });
});

app.post("/api/affiliate-payout", async (req, res) => {
  const referralCode = cleanReferralCode(req.body?.referralCode);
  const name = cleanName(req.body?.name);
  const email = cleanEmail(req.body?.email);
  const phone = cleanPhone(req.body?.phone);
  const iban = cleanIban(req.body?.iban);
  const acceptedTerms = Boolean(req.body?.acceptedTerms);

  if (!referralCode || !name || !isValidEmail(email) || !isValidPhone(phone) || !isValidIban(iban) || !acceptedTerms) {
    return res.status(400).json({
      ok: false,
      error: "Vul referral-code, naam, e-mail, telefoon, IBAN en akkoord volledig in.",
    });
  }

  const saved = await upsertRecord("guardtap_affiliates", {
    referral_code: referralCode,
    name,
    email,
    phone,
    iban,
    accepted_terms: true,
    status: "active",
    updated_at: new Date().toISOString(),
  }, "referral_code");

  if (!saved) {
    return res.status(500).json({ ok: false, error: "Uitbetaalgegevens opslaan mislukt." });
  }

  return res.json({ ok: true, referralCode });
});

app.get("/api/referrals/:code", async (req, res) => {
  const code = String(req.params.code || "").trim().replace(/[^a-zA-Z0-9-]/g, "").slice(0, 32);
  if (!code) return res.status(400).json({ ok: false, error: "Invalid referral code" });

  if (!hasDatabase()) {
    return res.json({
      ok: true,
      code,
      configured: false,
      message: "Database is nog niet gekoppeld.",
      paidCount: 0,
      pendingCommission: "0.00",
    });
  }

  try {
    const rows = await supabaseRequest("guardtap_referral_commissions", {
      method: "GET",
      query: `?referrer_code=eq.${encodeURIComponent(code)}&status=eq.pending&select=commission_value`,
    });
    const total = (rows || []).reduce((sum, row) => sum + Number(row.commission_value || 0), 0);
    return res.json({
      ok: true,
      code,
      configured: true,
      paidCount: rows?.length || 0,
      pendingCommission: total.toFixed(2),
    });
  } catch (error) {
    console.error("[/api/referrals] ERROR:", error.message);
    return res.status(500).json({ ok: false, error: "Referralgegevens ophalen mislukt" });
  }
});

// ==== PLANS voor /api/pay ====
const PLANS = {
  oneoff7:  { value: "7.00", currency: "EUR", description: "GuardTap Basis toegang - EUR 7 excl. btw" },
  premium5: { value: "5.00", currency: "EUR", description: "GuardTap Premium toegang - EUR 5 per maand" },
};

async function createPremiumFirstPayment({ referrer, buyerReferralCode, email, phone }) {
  const customer = await mollie.customers.create({
    email: email || undefined,
    name: email || "GuardTap premium klant",
    locale: "nl_NL",
    metadata: {
      plan: "premium5",
      referrer: referrer || null,
      buyerReferralCode: buyerReferralCode || null,
      phone: phone || null,
      source: "guardtap",
    },
  });

  const paymentConfig = addWebhookUrlWhenPublic({
    amount: { currency: "EUR", value: "5.00" },
    description: "GuardTap Premium - eerste maand",
    redirectUrl: getFrontendReturnUrl("premium5", buyerReferralCode),
    sequenceType: "first",
    metadata: {
      plan: "premium5",
      referrer: referrer || null,
      buyerReferralCode: buyerReferralCode || null,
      email: email || null,
      phone: phone || null,
      customerId: customer.id,
      createsSubscription: true,
    },
  }, "/api/webhook");

  return mollie.customerPayments.create({
    customerId: customer.id,
    ...paymentConfig,
  });
}

async function createPremiumSubscriptionAfterFirstPayment(payment) {
  const customerId = payment.metadata?.customerId;
  if (!customerId) {
    console.warn("[subscription] Geen customerId op premiumbetaling:", payment.id);
    return null;
  }

  const subscriptionConfig = addWebhookUrlWhenPublic({
    customerId,
    amount: { currency: "EUR", value: "5.00" },
    interval: "1 month",
    description: "GuardTap Premium - maandelijks",
    metadata: {
      plan: "premium5",
      email: payment.metadata?.email || null,
      phone: payment.metadata?.phone || null,
      referrer: payment.metadata?.referrer || null,
      buyerReferralCode: payment.metadata?.buyerReferralCode || null,
      firstPaymentId: payment.id,
    },
    idempotencyKey: `guardtap-premium-${payment.id}`,
  }, "/api/subscription-webhook");

  const subscription = await mollie.customerSubscriptions.create(subscriptionConfig);
  console.log("✅ Premium abonnement aangemaakt:", subscription.id, "customer:", customerId);
  return subscription;
}

async function handlePaidPayment(payment, label) {
  console.log("🧾 Payment status:", payment.id, payment.status, "plan:", payment.metadata?.plan);
  await recordPayment(payment);

  if (payment.status !== "paid") return;
  if (payment.metadata?.plan !== "premium5" || !payment.metadata?.createsSubscription) return;

  try {
    await createPremiumSubscriptionAfterFirstPayment(payment);
  } catch (error) {
    console.error(`[${label}] Premium abonnement aanmaken mislukt:`, error?.response?.body || error);
  }
}

// ==== /api/pay — twee knoppen ($7 / $5) ====
app.post("/api/pay", async (req, res) => {
  try {
    if (!requireMollie(res)) return;

    const { plan } = req.body || {};
    const referrer = cleanReferralCode(req.body?.referrer);
    const buyerReferralCode = cleanReferralCode(req.body?.buyerReferralCode);
    const email = cleanEmail(req.body?.email);
    const phone = cleanPhone(req.body?.phone);
    console.log("[/api/pay] body:", req.body, "BASE_URL:", BASE_URL);

    if (!isValidEmail(email) || !isValidPhone(phone)) {
      return res.status(400).json({
        error: "Email and phone are required",
        detail: "Vul e-mailadres en telefoonnummer in voordat je betaalt.",
      });
    }

    const cfg = PLANS[plan];
    if (!cfg) {
      console.error("[/api/pay] Unknown plan:", plan, "expected:", Object.keys(PLANS));
      return res.status(400).json({ error: "Unknown plan", expected: Object.keys(PLANS) });
    }

    if (plan === "premium5") {
      const payment = await createPremiumFirstPayment({ referrer, buyerReferralCode, email, phone });
      await recordPayment(payment, { checkoutUrl: payment.getCheckoutUrl() });
      console.log("✅ Created premium first payment:", payment.id, payment.getCheckoutUrl());
      return res.json({ id: payment.id, checkoutUrl: payment.getCheckoutUrl() });
    }

    const paymentConfig = addWebhookUrlWhenPublic({
      amount: { currency: cfg.currency, value: cfg.value },
      description: cfg.description,
      redirectUrl: getFrontendReturnUrl(plan, buyerReferralCode),
      metadata: { plan, referrer: referrer || null, buyerReferralCode: buyerReferralCode || null, email: email || null, phone: phone || null },
    }, "/api/webhook");

    const payment = await mollie.payments.create(paymentConfig);
    await recordPayment(payment, { checkoutUrl: payment.getCheckoutUrl() });

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
    await handlePaidPayment(p, "/api/webhook");
    return res.status(200).end(); // Mollie verwacht 200
  } catch (e) {
    console.error("[/api/webhook] ERROR:", e?.response?.body || e);
    return res.status(200).end(); // alsnog 200: geen eindeloze retries
  }
});

app.post("/api/subscription-webhook", async (req, res) => {
  try {
    if (!mollie) return res.status(200).end();

    console.log("[/api/subscription-webhook] HIT", new Date().toISOString(), "body:", req.body, "query:", req.query);
    const paymentId = req.body?.id || req.query?.id;
    if (!paymentId) return res.status(200).end();

    const p = await mollie.payments.get(paymentId);
    console.log("🔁 Premium maandbetaling:", p.id, p.status, "subscription:", p.subscriptionId || p.metadata?.subscriptionId);
    await recordPayment(p);
    return res.status(200).end();
  } catch (e) {
    console.error("[/api/subscription-webhook] ERROR:", e?.response?.body || e);
    return res.status(200).end();
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
    await handlePaidPayment(p, "/mollie/webhook");
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
