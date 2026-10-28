import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import Login from "./Login";

const emptyRecipe = { flour: "", water: "", salt: "", starter: "", starterHydration: 100, extras: [] };

const empty = { date: new Date().toISOString().slice(0, 10), flour: "", recipe: emptyRecipe, rating: 3, notes: "" };

const EXTRA_KINDS = { flour: "counts as flour", water: "counts as water", other: "doesn't count" };

const STAGES = ["Fed starter", "Mixed", "Stretch & fold", "Shaped", "Into fridge", "Baked"];

// Database column for each photo slot
const PHOTOS = [
  ["crust_photo_url", "Crust"],
  ["photo_url", "Crumb"],
];

const fmtTime =(t) => new Date(t).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

const fmtDate = (d) =>
  d ? new Date(d + "T00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "Undated";

const fmtGap = (ms) => {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

const toNum = (v) => (v === "" || v == null ? null : Number(v));

// Total hydration: water / flour, counting the flour and water inside the starter
// and any extra ingredients marked as flour or water.
function calcHydration(r) {
  if (!r) return null;
  const starter = toNum(r.starter) ?? 0;
  const starterFlour = starter / (1 + (toNum(r.starterHydration) ?? 100) / 100);
  let flour = (toNum(r.flour) ?? 0) + starterFlour;
  let water = (toNum(r.water) ?? 0) + (starter - starterFlour);
  for (const x of r.extras || []) {
    if (x.kind === "flour") flour += toNum(x.grams) ?? 0;
    if (x.kind === "water") water += toNum(x.grams) ?? 0;
  }
  return flour > 0 ? Math.round((water / flour) * 100) : null;
}

const cleanRecipe = (r) => ({
  flour: toNum(r.flour),
  water: toNum(r.water),
  salt: toNum(r.salt),
  starter: toNum(r.starter),
  starterHydration: toNum(r.starterHydration),
  extras: (r.extras || [])
    .filter((x) => x.name.trim() || x.grams !== "")
    .map((x) => ({ name: x.name.trim(), grams: toNum(x.grams), kind: x.kind })),
});

const recipeSummary = (r) =>
  [
    ["flour", r.flour],
    ["water", r.water],
    ["salt", r.salt],
    ["starter", r.starter],
    ...(r.extras || []).map((x) => [x.name, x.grams]),
  ]
    .filter(([, g]) => g != null)
    .map(([name, g]) => `${g}g ${name}`)
    .join(" · ");

const clean = (v) => {
  const recipe = cleanRecipe(v.recipe);
  return {
    date: v.date || null,
    flour: v.flour,
    recipe,
    // Older bakes without a recipe keep their manually entered hydration
    hydration: calcHydration(recipe) ?? toNum(v.hydration),
    rating: v.rating === "" ? null : Number(v.rating),
    notes: v.notes,
  };
};

async function shrinkImage(file, maxSize = 1600) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
}

function BakeFields({ values, setValues }) {
  const recipe = values.recipe;
  const update = (field) => (e) => {
    const value = e.target.value;
    setValues((v) => ({ ...v, [field]: value }));
  };
  const setRecipe = (fn) => setValues((v) => ({ ...v, recipe: fn(v.recipe) }));
  const updateRecipe = (field) => (e) => {
    const value = e.target.value;
    setRecipe((r) => ({ ...r, [field]: value }));
  };
  const updateExtra = (i, field) => (e) => {
    const value = e.target.value;
    setRecipe((r) => ({ ...r, extras: r.extras.map((x, j) => (j === i ? { ...x, [field]: value } : x)) }));
  };
  const addExtra = () => setRecipe((r) => ({ ...r, extras: [...r.extras, { name: "", grams: "", kind: "other" }] }));
  const removeExtra = (i) => setRecipe((r) => ({ ...r, extras: r.extras.filter((_, j) => j !== i) }));

  const hydration = calcHydration(recipe) ?? values.hydration;
  const unitInput = (value, onChange, unit = "g") => (
    <div className="unit-input">
      <input type="number" min="0" inputMode="decimal" value={value ?? ""} onChange={onChange} />
      <em>{unit}</em>
    </div>
  );
  const grams = (field, label, unit) => (
    <label className="field">
      <span>{label}</span>
      {unitInput(recipe[field], updateRecipe(field), unit)}
    </label>
  );

  return (
    <div className="fields">
      <div className="row">
        <label className="field">
          <span>Date</span>
          <input type="date" value={values.date ?? ""} onChange={update("date")} />
        </label>
        <div className="field">
          <span>Rating</span>
          <Stars value={values.rating} onChange={(n) => setValues((v) => ({ ...v, rating: n }))} />
        </div>
      </div>
      <label className="field">
        <span>Flour mix</span>
        <input placeholder="e.g. 80% bread, 20% whole wheat" value={values.flour ?? ""} onChange={update("flour")} />
      </label>
      <fieldset className="recipe">
        <legend>Recipe</legend>
        <div className="recipe-grid">
          {grams("flour", "Flour")}
          {grams("water", "Water")}
          {grams("salt", "Salt")}
          {grams("starter", "Starter")}
          {grams("starterHydration", "Starter hydr.", "%")}
        </div>
        {recipe.extras.map((x, i) => (
          <div key={i} className="extra">
            <input placeholder="Ingredient" value={x.name} onChange={updateExtra(i, "name")} />
            {unitInput(x.grams, updateExtra(i, "grams"))}
            <select value={x.kind} onChange={updateExtra(i, "kind")}>
              {Object.entries(EXTRA_KINDS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <button type="button" className="icon-btn" aria-label="Remove ingredient" onClick={() => removeExtra(i)}>×</button>
          </div>
        ))}
        <button type="button" className="btn-link" onClick={addExtra}>+ Add ingredient</button>
        <div className="hydration">
          <span>Hydration</span>
          <strong>{hydration != null ? `${hydration}%` : "—"}</strong>
        </div>
      </fieldset>
      <label className="field">
        <span>Notes</span>
        <textarea placeholder="How did it go? Next time I'll try…" value={values.notes ?? ""} onChange={update("notes")} />
      </label>
    </div>
  );
}

function Stars({ value, onChange }) {
  return (
    <div className="stars" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={Number(value) === n} aria-label={`${n} star${n > 1 ? "s" : ""}`}
          className={n <= Number(value) ? "on" : ""} onClick={() => onChange(n)}>★</button>
      ))}
    </div>
  );
}

export default function App() {
  // Login state
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const userId = session?.user?.id;

  const [bakes, setBakes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(empty);
  const [entryTimes, setEntryTimes] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [uploading, setUploading] = useState(null); // "bakeId:field" of the photo being uploaded
  const [askingId, setAskingId] = useState(null);

  // Check whether you're signed in, and watch for sign-in / sign-out
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  // Load bakes once you're signed in
  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    supabase
      .from("bakes")
      .select("*")
      .order("date", { ascending: false })
      .order("id", { ascending: false })
      .then(({ data, error }) => {
        if (error) alert("Couldn't load bakes: " + error.message);
        else setBakes(data);
        setLoading(false);
      });
  }, [userId]);

  async function saveBake(id, changes) {
    const { data, error } = await supabase.from("bakes").update(changes).eq("id", id).select().single();
    if (error) return alert("Couldn't save: " + error.message);
    setBakes((prev) => prev.map((b) => (b.id === id ? data : b)));
  }

  async function addBake(e) {
    e.preventDefault();
    const { data, error } = await supabase.from("bakes").insert({ ...clean(form), steps: [] }).select().single();
    if (error) return alert("Couldn't add bake: " + error.message);
    setBakes([data, ...bakes]);
    setForm(empty);
  }

  function startEdit(b) {
    setEditingId(b.id);
    setEditForm({
      date: b.date,
      flour: b.flour,
      hydration: b.hydration,
      recipe: { ...emptyRecipe, ...b.recipe, extras: b.recipe?.extras ?? [] },
      rating: b.rating,
      notes: b.notes,
    });
  }
  async function saveEdit() {
    await saveBake(editingId, clean(editForm));
    setEditingId(null);
  }
  async function deleteBake(id) {
    if (!window.confirm("Delete this bake and its timeline?")) return;
    const { error } = await supabase.from("bakes").delete().eq("id", id);
    if (error) return alert("Couldn't delete: " + error.message);
    setBakes(bakes.filter((b) => b.id !== id));
  }

  function logStep(b, stage) {
    const chosen = entryTimes[b.id];
    const time = chosen ? new Date(chosen).getTime() : Date.now();
    const steps = [...(b.steps || []), { stage, time }].sort((x, y) => x.time - y.time);
    saveBake(b.id, { steps });
    setEntryTimes({ ...entryTimes, [b.id]: "" });
  }
  function deleteStep(b, index) {
    saveBake(b.id, { steps: b.steps.filter((_, i) => i !== index) });
  }

  async function addPhoto(b, field, file) {
    if (!file) return;
    setUploading(`${b.id}:${field}`);
    try {
      const blob = await shrinkImage(file);
      const path = `${b.id}-${field === "crust_photo_url" ? "crust" : "crumb"}-${Date.now()}.jpg`;
      const { error } = await supabase.storage.from("photos").upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw error;
      const { data } = supabase.storage.from("photos").getPublicUrl(path);
      // A new photo makes Claude's old opinion stale
      await saveBake(b.id, { [field]: data.publicUrl, crumb_opinion: null });
    } catch (err) {
      alert("Couldn't upload photo: " + err.message);
    }
    setUploading(null);
  }

  async function askClaude(b) {
    setAskingId(b.id);
    const { data, error } = await supabase.functions.invoke("crumb-opinion", { body: { bakeId: b.id } });
    if (error) {
      const detail = await error.context?.json?.().catch(() => null);
      alert("Couldn't get Claude's opinion: " + (detail?.error ?? error.message));
    } else {
      await saveBake(b.id, { crumb_opinion: data.opinion });
    }
    setAskingId(null);
  }

  // Not sure yet whether you're signed in: show nothing for a split second
  if (!authReady) return null;
  // Not signed in: show the login screen instead of the app
  if (!session) return <Login />;

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <h1>Sourdough Log</h1>
          {!loading && <p className="muted">{bakes.length} {bakes.length === 1 ? "bake" : "bakes"} logged</p>}
        </div>
        <button type="button" className="btn ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>

      <section className="card">
        <h2>New bake</h2>
        <form onSubmit={addBake} className="fields">
          <BakeFields values={form} setValues={setForm} />
          <button className="btn primary block">Save bake</button>
        </form>
      </section>

      <h2 className="section-title">Past bakes</h2>
      {loading && <p className="muted">Loading…</p>}
      {!loading && bakes.length === 0 && <p className="empty">No bakes yet. Your first loaf goes above.</p>}
      {bakes.map((b) => {
        const steps = b.steps || [];
        const summary = b.recipe && recipeSummary(b.recipe);
        const hasPhoto = PHOTOS.some(([field]) => b[field]);
        return (
          <article key={b.id} className="card">
            {editingId === b.id ? (
              <div className="fields">
                <BakeFields values={editForm} setValues={setEditForm} />
                <div className="actions">
                  <button type="button" className="btn primary" onClick={saveEdit}>Save changes</button>
                  <button type="button" className="btn ghost" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <header className="bake-head">
                  <div>
                    <h3>{fmtDate(b.date)}</h3>
                    <div className="meta">
                      {b.hydration != null && <span className="pill">{b.hydration}% hydration</span>}
                      {b.rating > 0 && (
                        <span className="stars-static" aria-label={`${b.rating} of 5 stars`}>
                          {"★".repeat(b.rating)}<span className="dim">{"★".repeat(Math.max(0, 5 - b.rating))}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="actions">
                    <button type="button" className="btn ghost small" onClick={() => startEdit(b)}>Edit</button>
                    <button type="button" className="btn ghost small danger" onClick={() => deleteBake(b.id)}>Delete</button>
                  </div>
                </header>

                {b.flour && <p className="flour">{b.flour}</p>}
                {summary && <p className="recipe-line">{summary}</p>}
                {b.notes && <p className="notes">{b.notes}</p>}

                <div className="photos">
                  {PHOTOS.map(([field, label]) => {
                    const url = b[field];
                    const busy = uploading === `${b.id}:${field}`;
                    const fileInput = (
                      <input type="file" accept="image/*" hidden
                        onChange={(e) => { addPhoto(b, field, e.target.files[0]); e.target.value = ""; }} />
                    );
                    return url ? (
                      <figure key={field} className="photo">
                        <img src={url} alt={`${label} of the ${fmtDate(b.date)} bake`} />
                        <figcaption>{label}</figcaption>
                        <div className="photo-tools">
                          <label className="btn small">Replace{fileInput}</label>
                          <button type="button" className="btn small"
                            onClick={() => saveBake(b.id, { [field]: null, crumb_opinion: null })}>Remove</button>
                        </div>
                        {busy && <span className="photo-busy">Uploading…</span>}
                      </figure>
                    ) : (
                      <label key={field} className="photo empty-slot">
                        {busy ? "Uploading…" : `+ ${label} photo`}
                        {fileInput}
                      </label>
                    );
                  })}
                </div>
                {hasPhoto && (
                  <div className="photo-actions">
                    <button type="button" className="btn soft small" disabled={askingId === b.id} onClick={() => askClaude(b)}>
                      {askingId === b.id ? "Asking Claude…" : b.crumb_opinion ? "Ask Claude again" : "Ask Claude"}
                    </button>
                  </div>
                )}
                {hasPhoto && b.crumb_opinion && (
                  <blockquote className="opinion">
                    <span className="label">Claude's take</span>
                    {b.crumb_opinion}
                  </blockquote>
                )}
              </>
            )}

            <div className="timeline">
              <span className="label">Timeline</span>
              {steps.length > 0 && (
                <ol className="steps">
                  {steps.map((s, i) => (
                    <li key={i}>
                      <span className="stage">{s.stage}</span>
                      <time>{fmtTime(s.time)}</time>
                      {i > 0 && <span className="gap">+{fmtGap(s.time - steps[i - 1].time)}</span>}
                      <button type="button" className="icon-btn" aria-label={`Remove ${s.stage}`} onClick={() => deleteStep(b, i)}>×</button>
                    </li>
                  ))}
                </ol>
              )}
              <div className="chips">
                {STAGES.map((stage) => (
                  <button key={stage} type="button" className="chip" onClick={() => logStep(b, stage)}>{stage}</button>
                ))}
              </div>
              <label className="when">
                Log at
                <input
                  type="datetime-local"
                  value={entryTimes[b.id] || ""}
                  onChange={(e) => setEntryTimes({ ...entryTimes, [b.id]: e.target.value })}
                />
                <span>(blank = now)</span>
              </label>
            </div>
          </article>
        );
      })}
    </main>
  );
}