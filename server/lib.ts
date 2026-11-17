import crypto from "crypto";

export const G = "https://graph.instagram.com/v23.0";

const key = () =>
  crypto.createHash("sha256").update(process.env.TOKEN_ENCRYPTION_KEY!).digest();

export function enc(t: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const b = Buffer.concat([c.update(t, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), b].map((x) => x.toString("base64")).join(".");
}

export function dec(s: string) {
  const [iv, tag, b] = s.split(".").map((x) => Buffer.from(x, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(b), d.final()]).toString("utf8");
}

export async function igFetch(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j.error || j.error_message) {
    throw new Error(j.error?.message || j.error_message || `Instagram ${r.status}`);
  }
  return j;
}

const redirectUri = () => `${process.env.APP_BASE_URL}/auth/callback`;

export const authUrl = () =>
  "https://www.instagram.com/oauth/authorize?" +
  new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    // Added messaging permission
    scope: "instagram_business_basic,instagram_business_manage_comments,instagram_business_manage_messages",
  });

export async function connect(code: string) {
  const s = await igFetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID!,
      client_secret: process.env.INSTAGRAM_APP_SECRET!,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(),
      code: code.replace(/#_$/, ""),
    }),
  });

  const short = s.access_token ?? s.data?.[0]?.access_token;

  const l = await igFetch(
    "https://graph.instagram.com/access_token?" +
      new URLSearchParams({
        grant_type: "ig_exchange_token",
        client_secret: process.env.INSTAGRAM_APP_SECRET!,
        access_token: short,
      })
  );

  const me = await igFetch(
    `${G}/me?` +
      new URLSearchParams({
        fields: "user_id,username",
        access_token: l.access_token,
      })
  );

  // Subscribe to comments (you can also add messages later if needed)
  await igFetch(
    `${G}/me/subscribed_apps?` +
      new URLSearchParams({
        subscribed_fields: "comments",
        access_token: l.access_token,
      }),
    { method: "POST" }
  );

  return {
    igUserId: String(me.user_id ?? me.id),
    username: me.username as string,
    token: l.access_token as string,
    expiresAt: new Date(Date.now() + l.expires_in * 1000),
  };
}

/**
 * Send a text message (can include links) via Instagram DM
 */
export async function sendDmText(
  accessToken: string,
  recipientId: string, // Instagram-scoped ID (IGSID) of the person
  text: string
) {
  return igFetch(`${G}/me/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
    }),
  });
}

/**
 * Send a PDF file via Instagram DM
 * The PDF must be publicly accessible via HTTPS and ≤ 25 MB
 */
export async function sendDmPdf(
  accessToken: string,
  recipientId: string,
  pdfUrl: string
) {
  return igFetch(`${G}/me/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: {
        attachment: {
          type: "file",
          payload: {
            url: pdfUrl,
          },
        },
      },
    }),
  });
}

/**
 * Convenience helper – send text + optional PDF in one go
 */
export async function sendDm(
  accessToken: string,
  recipientId: string,
  options: {
    text?: string;
    pdfUrl?: string;
  }
) {
  const results = [];

  if (options.text) {
    results.push(await sendDmText(accessToken, recipientId, options.text));
  }

  if (options.pdfUrl) {
    results.push(await sendDmPdf(accessToken, recipientId, options.pdfUrl));
  }

  return results;
}