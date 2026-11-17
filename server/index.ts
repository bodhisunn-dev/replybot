import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cookieSession from "cookie-session";
import crypto from "crypto";
import path from "path";
import { eq, and, desc } from "drizzle-orm";
import { db, accounts, automations, handled, files, logs } from "./db";
import * as L from "./lib";

const app = express();
app.set("trust proxy", 1);
app.use(cookieSession({ name: "rb", secret: process.env.SESSION_SECRET!, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 30 * 864e5 }));

// ---------- Webhook (raw body for signature check) ----------
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === process.env.WEBHOOK_VERIFY_TOKEN)
    return res.status(200).send(String(req.query["hub.challenge"]));
  res.sendStatus(403);
});

app.post("/webhook", express.raw({ type: "*/*" }), (req, res) => {
  const sig = String(req.header("x-hub-signature-256") || "");
  const want = "sha256=" + crypto.createHmac("sha256", process.env.INSTAGRAM_APP_SECRET!).update(req.body).digest("hex");
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return (console.log("webhook rejected: bad signature (check INSTAGRAM_APP_SECRET)"), res.sendStatus(401));
  console.log("webhook received");
  res.sendStatus(200);
  try {
    const body = JSON.parse(req.body.toString());
    for (const e of body.entry ?? [])
      for (const c of e.changes ?? [])
        if (c.field === "comments") handleComment(String(e.id), c.value).catch((err) => console.error("comment error:", err.message));
  } catch (err) { console.error("bad webhook", err); }
});

const log = (accountId: number, line: string) => { console.log(line); db.insert(logs).values({ accountId, line }).catch(() => {}); };

async function handleComment(igUserId: string, v: any) {
  const [acc] = await db.select().from(accounts).where(eq(accounts.igUserId, igUserId));
  if (!acc) return console.log("webhook for unknown account", igUserId);
  if (!v?.id || !v.text) return;
  const who = v.from?.username ?? v.from?.id;
  if (v.parent_id) return log(acc.id, "skipped: reply to a comment by " + who);
  if (String(v.from?.id) === igUserId) return log(acc.id, "skipped: your own comment. Comment from a different account to test.");
  const text = String(v.text).toLowerCase();
  const list = await db.select().from(automations).where(and(eq(automations.accountId, acc.id), eq(automations.mediaId, String(v.media?.id)), eq(automations.active, true)));
  const hit = list.find((a) => a.triggers.some((t) => text.includes(t)));
  if (!hit) return log(acc.id, "no match: \"" + v.text + "\" by " + who + " (post " + v.media?.id + ", " + list.length + " active automation(s) on it)");
  const claimed = await db.insert(handled).values({ commentId: String(v.id) }).onConflictDoNothing().returning();
  if (!claimed.length) return;
  const token = L.dec(acc.tokenEnc);
  if (hit.replies.length) {
    try {
      const message = hit.replies[Math.floor(Math.random() * hit.replies.length)];
      await L.igFetch(L.G + "/" + v.id + "/replies", { method: "POST", body: new URLSearchParams({ message, access_token: token }) });
      log(acc.id, "public reply sent to " + who);
    } catch (e: any) { log(acc.id, "public reply FAILED for " + who + ": " + e.message); }
  }
  if (hit.dmText) {
    try {
      const message = hit.buttons.length
        ? { attachment: { type: "template", payload: { template_type: "button", text: hit.dmText.slice(0, 640), buttons: hit.buttons.slice(0, 3).map((b) => ({ type: "web_url", url: b.url, title: b.title.slice(0, 20) })) } } }
        : { text: hit.dmText.slice(0, 1000) };
      await L.igFetch(L.G + "/" + igUserId + "/messages?access_token=" + encodeURIComponent(token), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipient: { comment_id: v.id }, message }) });
      log(acc.id, "DM sent to " + who);
    } catch (e: any) { log(acc.id, "DM FAILED for " + who + ": " + e.message); }
  }
}

// ---------- Auth ----------
app.get("/auth/login", (_q, r) => r.redirect(L.authUrl()));
app.get("/auth/callback", async (req, res) => {
  try {
    const c = await L.connect(String(req.query.code));
    const vals = { igUserId: c.igUserId, username: c.username, tokenEnc: L.enc(c.token), tokenExpiresAt: c.expiresAt };
    const [acc] = await db.insert(accounts).values(vals).onConflictDoUpdate({ target: accounts.igUserId, set: vals }).returning();
    req.session = { accountId: acc.id };
    res.redirect("/");
  } catch (e: any) { res.status(400).send("Login failed: " + e.message); }
});

// ---------- API ----------
app.use(express.json({ limit: "8mb" }));
const auth = (req: Request, res: Response, next: NextFunction) => (req.session?.accountId ? next() : res.status(401).json({ error: "Not logged in" }));
const aid = (req: Request) => req.session!.accountId as number;
const wrap = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response) => fn(req, res).catch((e) => res.status(500).json({ error: e.message }));

app.get("/api/me", auth, wrap(async (req, res) => {
  const [a] = await db.select().from(accounts).where(eq(accounts.id, aid(req)));
  a ? res.json({ username: a.username }) : res.status(401).json({ error: "Not logged in" });
}));
app.post("/api/logout", (req, res) => { req.session = null; res.json({ ok: true }); });

app.get("/api/media", auth, wrap(async (req, res) => {
  const [a] = await db.select().from(accounts).where(eq(accounts.id, aid(req)));
  const j = await L.igFetch(`${L.G}/me/media?` + new URLSearchParams({ fields: "id,caption,media_type,thumbnail_url,media_url,permalink", limit: "30", access_token: L.dec(a.tokenEnc) }));
  res.json(j.data ?? []);
}));

app.get("/api/automations", auth, wrap(async (req, res) => {
  res.json(await db.select().from(automations).where(eq(automations.accountId, aid(req))).orderBy(desc(automations.createdAt)));
}));
app.post("/api/automations", auth, wrap(async (req, res) => {
  const clean = (x: any) => (Array.isArray(x) ? x.map((s) => String(s).trim()).filter(Boolean) : []);
  const triggers = clean(req.body.triggers).map((t) => t.toLowerCase());
  const replies = clean(req.body.replies);
  const dmText = String(req.body.dmText ?? "").trim();
  const buttons = (Array.isArray(req.body.buttons) ? req.body.buttons : []).filter((b: any) => b?.title?.trim() && /^https?:\/\//.test(String(b?.url))).slice(0, 3).map((b: any) => ({ title: String(b.title).trim(), url: String(b.url).trim() }));
  if (!req.body.mediaId || !triggers.length || (!replies.length && !dmText)) return res.status(400).json({ error: "Pick a post, add trigger words, and add a public reply or a DM." });
  if (buttons.length && !dmText) return res.status(400).json({ error: "Buttons need a DM message." });
  const [row] = await db.insert(automations).values({ accountId: aid(req), mediaId: String(req.body.mediaId), mediaLabel: String(req.body.mediaLabel ?? "").slice(0, 120), triggers, replies, dmText, buttons }).returning();
  res.json(row);
}));
app.post("/api/files", auth, wrap(async (req, res) => {
  const { name, data } = req.body;
  if (!name || !data || data.length > 7_000_000) return res.status(400).json({ error: "PDF missing or over 5 MB" });
  const id = crypto.randomBytes(16).toString("hex");
  await db.insert(files).values({ id, accountId: aid(req), name: String(name).slice(0, 100), mime: "application/pdf", data });
  res.json({ url: process.env.APP_BASE_URL + "/f/" + id });
}));
app.get("/api/logs", auth, wrap(async (req, res) => {
  res.json(await db.select().from(logs).where(eq(logs.accountId, aid(req))).orderBy(desc(logs.createdAt)).limit(30));
}));
app.get("/f/:id", async (req, res) => {
  const [f] = await db.select().from(files).where(eq(files.id, req.params.id));
  if (!f) return res.sendStatus(404);
  res.type(f.mime).set("Content-Disposition", 'inline; filename="' + f.name.replace(/[^\w.-]/g, "_") + '"').send(Buffer.from(f.data, "base64"));
});
app.patch("/api/automations/:id", auth, wrap(async (req, res) => {
  await db.update(automations).set({ active: !!req.body.active }).where(and(eq(automations.id, +req.params.id), eq(automations.accountId, aid(req))));
  res.json({ ok: true });
}));
app.delete("/api/automations/:id", auth, wrap(async (req, res) => {
  await db.delete(automations).where(and(eq(automations.id, +req.params.id), eq(automations.accountId, aid(req))));
  res.json({ ok: true });
}));

// ---------- Static client ----------
const dist = path.resolve("client/dist");
app.use(express.static(dist));
app.get("*", (_q, r) => r.sendFile(path.join(dist, "index.html")));

// ---------- Refresh long-lived tokens (60-day expiry) ----------
setInterval(async () => {
  for (const a of await db.select().from(accounts)) {
    if (a.tokenExpiresAt.getTime() - Date.now() > 10 * 864e5) continue;
    try {
      const j = await L.igFetch("https://graph.instagram.com/refresh_access_token?" + new URLSearchParams({ grant_type: "ig_refresh_token", access_token: L.dec(a.tokenEnc) }));
      await db.update(accounts).set({ tokenEnc: L.enc(j.access_token), tokenExpiresAt: new Date(Date.now() + j.expires_in * 1000) }).where(eq(accounts.id, a.id));
    } catch (e: any) { console.error("refresh failed", a.username, e.message); }
  }
}, 6 * 36e5);

app.listen(process.env.PORT || 3000, () => console.log("ReplyBot running"));