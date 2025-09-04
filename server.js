// server.js
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
const app = express();
// CORS: sta je Vercel front-end toe (fallback "*" voor lokaal testen)
const corsOrigin = process.env.CORS_ORIGIN || "*";
app.use(cors({ origin: corsOrigin }));
app.use(bodyParser.json());
// Root route (handig om te zien dat de backend leeft)
app.get("/", (_req, res) => {
res.json({ ok: true, service: "noodhulp-backend", routes: ["/", "/health"] });
});
// Health check (gebruik dit pad in Render: /health)
app.get("/health", (_req, res) => res.json({ ok: true }));
// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
console.log(`Backend running on http://localhost:${PORT} (CORS_ORIGIN=${corsOrigin})`);
});
