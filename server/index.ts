import express, { Request, Response, NextFunction } from "express";
import cookieSession from "cookie-session";
import crypto from "crypto";
import path from "path";
import { eq, and, desc } from "drizzle-orm";
import { db, accounts, automations, handled } from "./db";
import * as L from "./lib";

const app = express();
app.set("trust proxy", 1);
app.use(
  cookieSession({
    name: "rb",
    secret: process.env.SESSION_SECRET!,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 864e5,
  })
);

// ---------- Webhook (raw body for signature check) ----------
app.get("/webhook", (req, res) => {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === process.env.WEBHOOK_VERIFY_TOKEN
  ) {
    return res.status(200).send(String(req.query["hub.challenge"]));
  }
  res.sendStatus(403);
});

app.post("/webhook", express.raw({ type: "*/*" }), (req, res) => {
  const sig = String(req.header("x-hub-signature-256") || "");
  const want =
    "sha256=" +
    crypto
      .createHmac("sha256", process.env.INSTAGRAM_APP_SECRET!)
      .update(req.body)
      .digest("hex");

  if (
    sig.length !== want.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))
  ) {
    return res.sendStatus(401);
  }

  res.sendStatus(200);

  try {
    const body = JSON.parse(req.body.toString());
    for (const e of body.entry ?? []) {
      for (const c of e.changes ?? []) {
        if (c.field === "comments") {
          handleComment(String(e.id), c.value).catch((err) =>
            console.error("comment error:", err.message)
          );
        }
      }
    }
  } catch (err) {
    console.error("bad webhook", err);
  }
});

async function handleComment(igUserId: string, v: any) {
  // Skip replies to comments and own comments
  if (!v?.id || !v.text || v.parent_id || String(v.from?.id) === igUserId) return;

  const [acc] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.igUserId, igUserId));
  if (!acc || !v.media?.id) return;

  const text = String(v.text).toLowerCase();

  const list = await db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.accountId, acc.id),
        eq(automations.mediaId, String(v.media.id)),
        eq(automations.active, true)
      )
    );

  const hit = list.find((a) => a.triggers.some((t) => text.includes(t)));
  if (!hit) return;

  // Prevent duplicate handling
  const claimed = await db
    .insert(handled)
    .values({ commentId: String(v.id) })
    .onConflictDoNothing()
    .returning();
  if (!claimed.length) return;

  const token = L.dec(acc.tokenEnc);
  const commenterId = String(v.from.id); // Instagram-scoped ID

  // 1. Public reply (existing behavior)
  if (hit.replies && hit.replies.length > 0) {
    const message = hit.replies[Math.floor(Math.random() * hit.replies.length)];
    await L.igFetch(`${L.G}/${v.id}/replies`, {
      method: "POST",
      body: new URLSearchParams({ message, access_token: token }),
    });
  }

  // 2. Send Direct Message (new)
  // Only if the automation has DM content configured
  if (hit.dmText || hit.dmPdfUrl) {
    try {
      await L.sendDm(token, commenterId, {
        text: hit.dmText || undefined,
        pdfUrl: hit.dmPdfUrl || undefined,
      });
    } catch (err: any) {
      console.error("Failed to send DM:", err.message);
    }
  }
}

// ---------- Auth ----------
app.get("/auth/login", (_q, r) => r.redirect(L.authUrl()));
app.get("/auth/callback", async (req, res) => {
  try {
    const c = await L.connect(String(req.query.code));
    const vals = {
      igUserId: c.igUserId,
      username: c.username,
      tokenEnc: L.enc(c.token),
      tokenExpiresAt: c.expiresAt,
    };
    const [acc] = await db
      .insert(accounts)
      .values(vals)
      .onConflictDoUpdate({ target: accounts.igUserId, set: vals })
      .returning();
    req.session = { accountId: acc.id };
    res.redirect("/");
  } catch (e: any) {
    res.status(400).send("Login failed: " + e.message);
  }
});

// ---------- API ----------
app.use(express.json());

const auth = (req: Request, res: Response, next: NextFunction) =>
  req.session?.accountId ? next() : res.status(401).json({ error: "Not logged in" });

const aid = (req: Request) => req.session!.accountId as number;

const wrap =
  (fn: (req: Request, res: Response) => Promise<any>) =>
  (req: Request, res: Response) =>
    fn(req, res).catch((e) => res.status(500).json({ error: e.message }));

app.get(
  "/api/me",
  auth,
  wrap(async (req, res) => {
    const [a] = await db.select().from(accounts).where(eq(accounts.id, aid(req)));
    a ? res.json({ username: a.username }) : res.status(401).json({ error: "Not logged in" });
  })
);

app.post("/api/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get(
  "/api/media",
  auth,
  wrap(async (req, res) => {
    const [a] = await db.select().from(accounts).where(eq(accounts.id, aid(req)));
    const j = await L.igFetch(
      `${L.G}/me/media?` +
        new URLSearchParams({
          fields: "id,caption,media_type,thumbnail_url,media_url,permalink",
          limit: "30",
          access_token: L.dec(a.tokenEnc),
        })
    );
    res.json(j.data ?? []);
  })
);

app.get(
  "/api/automations",
  auth,
  wrap(async (req, res) => {
    res.json(
      await db
        .select()
        .from(automations)
        .where(eq(automations.accountId, aid(req)))
        .orderBy(desc(automations.createdAt))
    );
  })
);

app.post(
  "/api/automations",
  auth,
  wrap(async (req, res) => {
    const clean = (x: any) =>
      Array.isArray(x) ? x.map((s) => String(s).trim()).filter(Boolean) : [];

    const triggers = clean(req.body.triggers).map((t) => t.toLowerCase());
    const replies = clean(req.body.replies);

    if (!req.body.mediaId || !triggers.length) {
      return res.status(400).json({ error: "Pick a post and add at least one trigger word." });
    }

    // Allow creating automation with only DM (no public replies)
    if (!replies.length && !req.body.dmText && !req.body.dmPdfUrl) {
      return res
        .status(400)
        .json({ error: "Add at least one public reply or DM content." });
    }

    const [row] = await db
      .insert(automations)
      .values({
        accountId: aid(req),
        mediaId: String(req.body.mediaId),
        mediaLabel: String(req.body.mediaLabel ?? "").slice(0, 120),
        triggers,
        replies,
        // New DM fields
        dmText: req.body.dmText ? String(req.body.dmText).trim() : null,
        dmPdfUrl: req.body.dmPdfUrl ? String(req.body.dmPdfUrl).trim() : null,
      })
      .returning();

    res.json(row);
  })
);

app.patch(
  "/api/automations/:id",
  auth,
  wrap(async (req, res) => {
    await db
      .update(automations)
      .set({ active: !!req.body.active })
      .where(and(eq(automations.id, +req.params.id), eq(automations.accountId, aid(req))));
    res.json({ ok: true });
  })
);

app.delete(
  "/api/automations/:id",
  auth,
  wrap(async (req, res) => {
    await db
      .delete(automations)
      .where(and(eq(automations.id, +req.params.id), eq(automations.accountId, aid(req))));
    res.json({ ok: true });
  })
);

// ---------- Static client ----------
const dist = path.resolve("client/dist");
app.use(express.static(dist));
app.get("*", (_q, r) => r.sendFile(path.join(dist, "index.html")));

// ---------- Refresh long-lived tokens (60-day expiry) ----------
setInterval(async () => {
  for (const a of await db.select().from(accounts)) {
    if (a.tokenExpiresAt.getTime() - Date.now() > 10 * 864e5) continue;
    try {
      const j = await L.igFetch(
        "https://graph.instagram.com/refresh_access_token?" +
          new URLSearchParams({
            grant_type: "ig_refresh_token",
            access_token: L.dec(a.tokenEnc),
          })
      );
      await db
        .update(accounts)
        .set({
          tokenEnc: L.enc(j.access_token),
          tokenExpiresAt: new Date(Date.now() + j.expires_in * 1000),
        })
        .where(eq(accounts.id, a.id));
    } catch (e: any) {
      console.error("refresh failed", a.username, e.message);
    }
  }
}, 6 * 36e5);

app.listen(process.env.PORT || 3000, () => console.log("ReplyBot running"));