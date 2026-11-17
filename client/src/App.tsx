import { useEffect, useState } from "react";

type Auto = { id: number; mediaId: string; mediaLabel: string; triggers: string[]; replies: string[]; active: boolean };
type Media = { id: string; caption?: string; media_type: string; thumbnail_url?: string; media_url?: string };

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
  const [err, setErr] = useState("");

  const load = () => api("/api/automations").then(setAutos);
  useEffect(() => {
    api("/api/me").then((m) => { setMe(m); load(); api("/api/media").then(setMedia).catch((e) => setErr(e.message)); }).catch(() => setMe(null));
  }, []);

  async function create() {
    setErr("");
    try {
      await api("/api/automations", { method: "POST", body: JSON.stringify({
        mediaId: sel?.id, mediaLabel: sel?.caption ?? sel?.media_type,
        triggers: trig.split(","), replies: reps.split("\n"),
      }) });
      setSel(null); setTrig(""); setReps(""); load();
    } catch (e: any) { setErr(e.message); }
  }

  if (me === undefined) return <p className="p-8">Loading…</p>;
  if (me === null)
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="text-center space-y-4">
          <h1 className="text-3xl font-bold">ReplyBot</h1>
          <p className="text-slate-600">Auto-reply to Instagram comments.</p>
          <a href="/auth/login" className="inline-block rounded-lg bg-pink-600 px-5 py-2.5 font-medium text-white">Connect Instagram</a>
        </div>
      </div>
    );

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ReplyBot</h1>
        <span className="text-sm text-slate-600">@{me.username} · <button className="underline" onClick={() => api("/api/logout", { method: "POST" }).then(() => setMe(null))}>Log out</button></span>
      </header>

      <section className="space-y-4 rounded-xl bg-white p-5 shadow">
        <h2 className="font-semibold">New automation</h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {media.map((m) => (
            <button key={m.id} onClick={() => setSel(m)} className={`aspect-square overflow-hidden rounded-lg border-2 bg-slate-100 text-xs ${sel?.id === m.id ? "border-pink-600" : "border-transparent"}`}>
              {m.thumbnail_url || m.media_url ? <img src={m.thumbnail_url || m.media_url} className="h-full w-full object-cover" /> : m.media_type}
            </button>
          ))}
        </div>
        {sel && <p className="text-sm text-slate-600 line-clamp-2">Selected: {sel.caption || sel.media_type}</p>}
        <input className="w-full rounded border p-2" placeholder="Trigger words, comma-separated (e.g. guide, link)" value={trig} onChange={(e) => setTrig(e.target.value)} />
        <textarea className="h-28 w-full rounded border p-2" placeholder="Reply variations, one per line" value={reps} onChange={(e) => setReps(e.target.value)} />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button onClick={create} className="rounded-lg bg-pink-600 px-4 py-2 font-medium text-white">Create automation</button>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Your automations</h2>
        {!autos.length && <p className="text-sm text-slate-500">None yet.</p>}
        {autos.map((a) => (
          <div key={a.id} className="space-y-1 rounded-xl bg-white p-4 shadow">
            <p className="line-clamp-1 text-sm font-medium">{a.mediaLabel || a.mediaId}</p>
            <p className="text-sm">Triggers: {a.triggers.join(", ")}</p>
            <p className="text-sm text-slate-600">{a.replies.length} reply variation(s)</p>
            <div className="flex gap-3 pt-1 text-sm">
              <button className="underline" onClick={() => api(`/api/automations/${a.id}`, { method: "PATCH", body: JSON.stringify({ active: !a.active }) }).then(load)}>{a.active ? "Pause" : "Resume"}</button>
              <button className="text-red-600 underline" onClick={() => api(`/api/automations/${a.id}`, { method: "DELETE" }).then(load)}>Delete</button>
              {!a.active && <span className="text-slate-500">(paused)</span>}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
