import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import Login from "./Login";

const emptyRecipe = { flour: "", water: "", salt: "", starter: "", starterHydration: 100, extras: [] };

const empty = { date: new Date().toISOString().slice(0, 10), flour: "", recipe: emptyRecipe, rating: 3, notes: "" };

const EXTRA_KINDS = { flour: "counts as flour", water: "counts as water", other: "doesn't count" };

const STAGES = ["Fed starter", "Mixed", "Stretch & fold", "Shaped", "Into fridge", "Baked"];

const fmtTime = (t) => new Date(t).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

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
  const grams = (field, label) => (
    <label>
      {label}: <input type="number" min="0" style={{ width: 70 }} value={recipe[field] ?? ""} onChange={updateRecipe(field)} />
    </label>
  );

  return (
    <>
      <input type="date" value={values.date ?? ""} onChange={update("date")} />
      <input placeholder="Flour mix (e.g. 80% bread, 20% whole wheat)" value={values.flour ?? ""} onChange={update("flour")} />
      <fieldset style={{ display: "grid", gap: 6 }}>
        <legend>Recipe (grams)</legend>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {grams("flour", "Flour")}
          {grams("water", "Water")}
          {grams("salt", "Salt")}
          {grams("starter", "Starter")}
          {grams("starterHydration", "Starter hydration %")}
        </div>
        {recipe.extras.map((x, i) => (
          <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            <input placeholder="Ingredient" value={x.name} onChange={updateExtra(i, "name")} />
            <input type="number" min="0" placeholder="g" style={{ width: 70 }} value={x.grams ?? ""} onChange={updateExtra(i, "grams")} />
            <select value={x.kind} onChange={updateExtra(i, "kind")}>
              {Object.entries(EXTRA_KINDS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <button type="button" onClick={() => removeExtra(i)}>×</button>
          </div>
        ))}
        <div>
          <button type="button" onClick={addExtra}>+ Add ingredient</button>
        </div>
        <strong>Hydration: {hydration != null ? `${hydration}%` : "—"}</strong>
      </fieldset>
      <label>Rating (1–5): <input type="number" min="1" max="5" value={values.rating ?? ""} onChange={update("rating")} /></label>
      <textarea placeholder="Notes / next time I'll try…" value={values.notes ?? ""} onChange={update("notes")} />
    </>
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
  const [uploadingId, setUploadingId] = useState(null);
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

  async function addPhoto(b, file) {
    if (!file) return;
    setUploadingId(b.id);
    try {
      const blob = await shrinkImage(file);
      const path = `${b.id}-${Date.now()}.jpg`;
      const { error } = await supabase.storage.from("photos").upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw error;
      const { data } = supabase.storage.from("photos").getPublicUrl(path);
      await saveBake(b.id, { photo_url: data.publicUrl, crumb_opinion: null });
    } catch (err) {
      alert("Couldn't upload photo: " + err.message);
    }
    setUploadingId(null);
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
    <main style={{ maxWidth: 480, margin: "2rem auto", padding: "0 16px", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Sourdough Log</h1>
        <button type="button" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>

      <form onSubmit={addBake} style={{ display: "grid", gap: 8 }}>
        <BakeFields values={form} setValues={setForm} />
        <button>Save bake</button>
      </form>

      <h2>Past bakes</h2>
      {loading && <p>Loading…</p>}
      {bakes.map((b) => {
        const steps = b.steps || [];
        return (
          <article key={b.id} style={{ borderTop: "1px solid #ddd", padding: "8px 0" }}>
            {editingId === b.id ? (
              <div style={{ display: "grid", gap: 8 }}>
                <BakeFields values={editForm} setValues={setEditForm} />
                <div>
                  <button type="button" onClick={saveEdit}>Save changes</button>{" "}
                  <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <strong>{b.date}</strong> · {b.hydration ?? "—"}% · {"★".repeat(b.rating || 0)}
                <div>{b.flour}</div>
                {b.recipe && <div style={{ fontSize: "0.9em", color: "#555" }}>{recipeSummary(b.recipe)}</div>}
                <p>{b.notes}</p>

                {b.photo_url && (
                  <img src={b.photo_url} alt="Crumb" style={{ width: "100%", borderRadius: 8, display: "block" }} />
                )}
                <div style={{ margin: "6px 0" }}>
                  <label>
                    {b.photo_url ? "Replace photo: " : "Crumb photo: "}
                    <input type="file" accept="image/*" onChange={(e) => addPhoto(b, e.target.files[0])} />
                  </label>
                  {uploadingId === b.id && <span> Uploading…</span>}
                  {b.photo_url && (
                    <button type="button" onClick={() => saveBake(b.id, { photo_url: null, crumb_opinion: null })}>Remove photo</button>
                  )}
                </div>

                {b.photo_url && (
                  <div style={{ margin: "6px 0" }}>
                    {b.crumb_opinion && (
                      <blockquote style={{ margin: "0 0 6px", padding: "6px 10px", background: "#f5f0e8", borderRadius: 6 }}>
                        <strong>Claude:</strong> {b.crumb_opinion}
                      </blockquote>
                    )}
                    <button type="button" disabled={askingId === b.id} onClick={() => askClaude(b)}>
                      {askingId === b.id ? "Asking Claude…" : b.crumb_opinion ? "Ask Claude again" : "Ask Claude about this crumb"}
                    </button>
                  </div>
                )}

                <button type="button" onClick={() => startEdit(b)}>Edit</button>{" "}
                <button type="button" onClick={() => deleteBake(b.id)}>Delete bake</button>
              </>
            )}

            <ul>
              {steps.map((s, i) => (
                <li key={i}>
                  {s.stage} — {fmtTime(s.time)}
                  {i > 0 && ` (+${fmtGap(s.time - steps[i - 1].time)})`}{" "}
                  <button type="button" onClick={() => deleteStep(b, i)}>×</button>
                </li>
              ))}
            </ul>

            <label>
              Time (blank = now):{" "}
              <input
                type="datetime-local"
                value={entryTimes[b.id] || ""}
                onChange={(e) => setEntryTimes({ ...entryTimes, [b.id]: e.target.value })}
              />
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
              {STAGES.map((stage) => (
                <button key={stage} type="button" onClick={() => logStep(b, stage)}>{stage}</button>
              ))}
            </div>
          </article>
        );
      })}
    </main>
  );
}