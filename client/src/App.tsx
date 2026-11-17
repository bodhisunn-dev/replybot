import { useEffect, useState } from "react";

type Btn = { title: string; url: string };
type Auto = { id: number; mediaLabel: string; triggers: string[]; replies: string[]; dmText: string; buttons: Btn[]; active: boolean };
type Media = { id: string; caption?: string; media_type: string; thumbnail_url?: string; media_url?: string };
type Log = { id: number; line: string; createdAt: string };

async function api(p: string, o: RequestInit = {}) {
  const r = await fetch(p, { ...o, headers: { "Content-Type": "application/json" } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Request failed");
  return j;
}
const card = "rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200";
const input = "w-full rounded-lg border border-slate-300 p-2.5 text-sm focus:border-pink-500 focus:outline-none";

function Preview({ text, btns }: { text: string; btns: Btn[] }) {
  return (
    <div className="mx-auto w-full max-w-xs rounded-3xl bg-slate-100 p-4">
      <p className="mb-2 text-center text-xs text-slate-500">Preview of the DM</p>
      <div className="rounded-2xl rounded-bl-sm bg-white p-3 text-sm shadow">
        <p className="whitespace-pre-wrap">{text || "Your message appears here…"}</p>
        {btns.filter((b) => b.title).map((b, i) => (
          <div key={i} className="mt-2 rounded-lg bg-slate-100 py-2 text-center font-medium text-blue-600">{b.title.slice(0, 20)}</div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState<{ username: string } | null | undefined>(undefined);
  const [autos, setAutos] = useState<Auto[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [sel, setSel] = useState<Media | null>(null);
  const [trig, setTrig] = useState("");
  const [reps, setReps] = useState("");
  const [dm, setDm] = useState("");
  const [btns, setBtns] = useState<Btn[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => { api("/api/automations").then(setAutos); api("/api/logs").then(setLogs); };
  useEffect(() => {
    api("/api/me").then((m) => { setMe(m); load(); api("/api/media").then(setMedia).catch((e) => setErr(e.message)); }).catch(() => setMe(null));
    const t = setInterval(() => api("/api/logs").then(setLogs).catch(() => {}), 10000);
    return () => clearInterval(t);
  }, []);

  async function upload(f?: File) {
    if (!f) return;
    setErr(""); setBusy(true);
    try {
      const data = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(f); });
      const { url } = await api("/api/files", { method: "POST", body: JSON.stringify({ name: f.name, data }) });
      setBtns((b) => [...b, { title: "Get the PDF", url }].slice(0, 3));
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  async function create() {
    setErr("");
    try {
      await api("/api/automations", { method: "POST", body: JSON.stringify({
        mediaId: sel?.id, mediaLabel: sel?.caption ?? sel?.media_type,
        triggers: trig.split(","), replies: reps.split("\n"), dmText: dm, buttons: btns,
      }) });
      setSel(null); setTrig(""); setReps(""); setDm(""); setBtns([]); load();
    } catch (e: any) { setErr(e.message); }
  }

  if (me === undefined) return <p className="p-8">Loading…</p>;
  if (me === null)
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="space-y-4 text-center">
          <h1 className="text-3xl font-bold">ReplyBot</h1>
          <p className="text-slate-600">Comment-to-DM automation for Instagram.</p>
          <a href="/auth/login" className="inline-block rounded-lg bg-pink-600 px-5 py-2.5 font-medium text-white">Connect Instagram</a>
        </div>
      </div>
    );

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ReplyBot</h1>
        <span className="text-sm text-slate-600">@{me.username} · <button className="underline" onClick={() => api("/api/logout", { method: "POST" }).then(() => setMe(null))}>Log out</button></span>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <section className={card}>
            <h2 className="mb-3 font-semibold">1. Pick a post or reel</h2>
            <div className="grid max-h-64 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
              {media.map((m) => (
                <button key={m.id} onClick={() => setSel(m)} className={`aspect-square overflow-hidden rounded-lg border-2 bg-slate-100 text-xs ${sel?.id === m.id ? "border-pink-600" : "border-transparent"}`}>
                  {m.thumbnail_url || m.media_url ? <img src={m.thumbnail_url || m.media_url} className="h-full w-full object-cover" /> : m.media_type}
                </button>
              ))}
            </div>
            {sel && <p className="mt-2 line-clamp-2 text-sm text-slate-600">Selected: {sel.caption || sel.media_type}</p>}
          </section>

          <section className={card + " space-y-2"}>
            <h2 className="font-semibold">2. Trigger words</h2>
            <input className={input} placeholder="guide, link, pdf (comma-separated)" value={trig} onChange={(e) => setTrig(e.target.value)} />
          </section>

          <section className={card + " space-y-2"}>
            <h2 className="font-semibold">3. Public reply <span className="text-sm font-normal text-slate-500">(optional, one random line is posted under the comment)</span></h2>
            <textarea className={input + " h-24"} placeholder={"Check your DMs 📩\nSent you the link!"} value={reps} onChange={(e) => setReps(e.target.value)} />
          </section>

          <section className={card + " space-y-3"}>
            <h2 className="font-semibold">4. DM message <span className="text-sm font-normal text-slate-500">(sent privately to the commenter)</span></h2>
            <textarea className={input + " h-28"} placeholder="Hey! Thanks for commenting. Here's the guide you asked for 👇" value={dm} onChange={(e) => setDm(e.target.value)} />
            <p className="text-sm font-medium">Buttons (up to 3)</p>
            {btns.map((b, i) => (
              <div key={i} className="flex gap-2">
                <input className={input + " w-40"} maxLength={20} placeholder="Button text" value={b.title} onChange={(e) => setBtns(btns.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                <input className={input} placeholder="https://…" value={b.url} onChange={(e) => setBtns(btns.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                <button className="px-2 text-red-600" onClick={() => setBtns(btns.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            {btns.length < 3 && (
              <div className="flex flex-wrap gap-2 text-sm">
                <button className="rounded-lg border px-3 py-1.5" onClick={() => setBtns([...btns, { title: "", url: "" }])}>+ Link button</button>
                <label className="cursor-pointer rounded-lg border px-3 py-1.5">{busy ? "Uploading…" : "+ Upload PDF"}<input type="file" accept="application/pdf" className="hidden" onChange={(e) => upload(e.target.files?.[0])} /></label>
              </div>
            )}
            <p className="text-xs text-slate-500">PDFs (max 5 MB) are hosted by ReplyBot and delivered as a tappable button.</p>
          </section>

          {err && <p className="text-sm text-red-600">{err}</p>}
          <button onClick={create} className="rounded-lg bg-pink-600 px-5 py-2.5 font-medium text-white">Create automation</button>
        </div>

        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Preview text={dm} btns={btns} />
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold">Your automations</h2>
        {!autos.length && <p className="text-sm text-slate-500">None yet.</p>}
        {autos.map((a) => (
          <div key={a.id} className={card + " space-y-1 text-sm"}>
            <p className="line-clamp-1 font-medium">{a.mediaLabel}</p>
            <p>Triggers: {a.triggers.join(", ")}</p>
            <p className="text-slate-600">{a.replies.length} public repl{a.replies.length === 1 ? "y" : "ies"} · DM {a.dmText ? `on (${a.buttons.length} button${a.buttons.length === 1 ? "" : "s"})` : "off"}</p>
            <div className="flex gap-3 pt-1">
              <button className="underline" onClick={() => api(`/api/automations/${a.id}`, { method: "PATCH", body: JSON.stringify({ active: !a.active }) }).then(load)}>{a.active ? "Pause" : "Resume"}</button>
              <button className="text-red-600 underline" onClick={() => api(`/api/automations/${a.id}`, { method: "DELETE" }).then(load)}>Delete</button>
              {!a.active && <span className="text-slate-500">(paused)</span>}
            </div>
          </div>
        ))}
      </section>

      <section className={card}>
        <h2 className="mb-2 font-semibold">Activity log</h2>
        {!logs.length && <p className="text-sm text-slate-500">Nothing yet. If you comment a trigger and no line appears here, Meta isn't sending webhooks.</p>}
        <ul className="space-y-1 text-xs text-slate-700">
          {logs.map((l) => <li key={l.id}><span className="text-slate-400">{new Date(l.createdAt).toLocaleTimeString()}</span> {l.line}</li>)}
        </ul>
      </section>
    </div>
  );
}