import { useEffect, useState } from "react";

type Auto = {
  id: number;
  mediaId: string;
  mediaLabel: string;
  triggers: string[];
  replies: string[];
  active: boolean;
  dmText?: string | null;
  dmPdfUrl?: string | null;
};

type Media = {
  id: string;
  caption?: string;
  media_type: string;
  thumbnail_url?: string;
  media_url?: string;
};

async function api(p: string, o: RequestInit = {}) {
  const r = await fetch(p, { ...o, headers: { "Content-Type": "application/json" } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || "Request failed"), { status: r.status });
  return j;
}

export default function App() {
  const [me, setMe] = useState<{ username: string } | null | undefined>(undefined);
  const [autos, setAutos] = useState<Auto[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [sel, setSel] = useState<Media | null>(null);
  const [trig, setTrig] = useState("");
  const [reps, setReps] = useState("");
  const [dmText, setDmText] = useState("");
  const [dmPdfUrl, setDmPdfUrl] = useState("");
  const [err, setErr] = useState("");

  const load = () => api("/api/automations").then(setAutos);

  useEffect(() => {
    api("/api/me")
      .then((m) => {
        setMe(m);
        load();
        api("/api/media").then(setMedia).catch((e) => setErr(e.message));
      })
      .catch(() => setMe(null));
  }, []);

  async function create() {
    setErr("");
    try {
      await api("/api/automations", {
        method: "POST",
        body: JSON.stringify({
          mediaId: sel?.id,
          mediaLabel: sel?.caption ?? sel?.media_type,
          triggers: trig.split(","),
          replies: reps.split("\n").map((r) => r.trim()).filter(Boolean),
          dmText: dmText.trim() || null,
          dmPdfUrl: dmPdfUrl.trim() || null,
        }),
      });
      setSel(null);
      setTrig("");
      setReps("");
      setDmText("");
      setDmPdfUrl("");
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  if (me === undefined) return <p className="p-8">Loading…</p>;

  if (me === null)
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="text-center space-y-4">
          <h1 className="text-3xl font-bold">ReplyBot</h1>
          <p className="text-slate-600">Auto-reply to Instagram comments + send DMs.</p>
          <a
            href="/auth/login"
            className="inline-block rounded-lg bg-pink-600 px-5 py-2.5 font-medium text-white"
          >
            Connect Instagram
          </a>
        </div>
      </div>
    );

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ReplyBot</h1>
        <span className="text-sm text-slate-600">
          @{me.username} ·{" "}
          <button
            className="underline"
            onClick={() => api("/api/logout", { method: "POST" }).then(() => setMe(null))}
          >
            Log out
          </button>
        </span>
      </header>

      {/* Create new automation */}
      <section className="space-y-4 rounded-xl bg-white p-5 shadow">
        <h2 className="font-semibold">New automation</h2>

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {media.map((m) => (
            <button
              key={m.id}
              onClick={() => setSel(m)}
              className={`aspect-square overflow-hidden rounded-lg border-2 bg-slate-100 text-xs ${
                sel?.id === m.id ? "border-pink-600" : "border-transparent"
              }`}
            >
              {m.thumbnail_url || m.media_url ? (
                <img
                  src={m.thumbnail_url || m.media_url}
                  className="h-full w-full object-cover"
                />
              ) : (
                m.media_type
              )}
            </button>
          ))}
        </div>

        {sel && (
          <p className="text-sm text-slate-600 line-clamp-2">
            Selected: {sel.caption || sel.media_type}
          </p>
        )}

        <input
          className="w-full rounded border p-2"
          placeholder="Trigger words, comma-separated (e.g. guide, link, pdf)"
          value={trig}
          onChange={(e) => setTrig(e.target.value)}
        />

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Public comment replies (optional)
          </label>
          <textarea
            className="h-24 w-full rounded border p-2"
            placeholder="Reply variations, one per line"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
          />
        </div>

        <div className="border-t pt-4">
          <h3 className="mb-2 font-medium">Direct Message (optional)</h3>

          <textarea
            className="mb-3 h-20 w-full rounded border p-2"
            placeholder="DM text (you can include links here)"
            value={dmText}
            onChange={(e) => setDmText(e.target.value)}
          />

          <input
            className="w-full rounded border p-2"
            placeholder="PDF URL (public HTTPS link, max 25MB)"
            value={dmPdfUrl}
            onChange={(e) => setDmPdfUrl(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">
            The PDF must be publicly accessible. Upload it to Google Drive, Dropbox, or any file host and paste the direct link.
          </p>
        </div>

        {err && <p className="text-sm text-red-600">{err}</p>}

        <button
          onClick={create}
          className="rounded-lg bg-pink-600 px-4 py-2 font-medium text-white"
        >
          Create automation
        </button>
      </section>

      {/* List of automations */}
      <section className="space-y-3">
        <h2 className="font-semibold">Your automations</h2>
        {!autos.length && <p className="text-sm text-slate-500">None yet.</p>}

        {autos.map((a) => (
          <div key={a.id} className="space-y-1 rounded-xl bg-white p-4 shadow">
            <p className="line-clamp-1 text-sm font-medium">
              {a.mediaLabel || a.mediaId}
            </p>
            <p className="text-sm">Triggers: {a.triggers.join(", ")}</p>

            {a.replies.length > 0 && (
              <p className="text-sm text-slate-600">
                {a.replies.length} public reply variation(s)
              </p>
            )}

            {(a.dmText || a.dmPdfUrl) && (
              <div className="mt-1 text-sm text-slate-600">
                <p className="font-medium text-slate-700">DM:</p>
                {a.dmText && <p className="line-clamp-2">{a.dmText}</p>}
                {a.dmPdfUrl && (
                  <p className="truncate text-blue-600">
                    PDF: {a.dmPdfUrl}
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-3 pt-1 text-sm">
              <button
                className="underline"
                onClick={() =>
                  api(`/api/automations/${a.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ active: !a.active }),
                  }).then(load)
                }
              >
                {a.active ? "Pause" : "Resume"}
              </button>
              <button
                className="text-red-600 underline"
                onClick={() =>
                  api(`/api/automations/${a.id}`, { method: "DELETE" }).then(load)
                }
              >
                Delete
              </button>
              {!a.active && <span className="text-slate-500">(paused)</span>}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}