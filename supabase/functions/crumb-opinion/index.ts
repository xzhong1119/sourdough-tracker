// Asks Claude for a short opinion on a bake's crumb photo.
// Runs on Supabase so the Anthropic API key never reaches the browser.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM = `You are an experienced sourdough baker reviewing a home baker's crumb photo.
Judge the crumb: openness and evenness of the holes, signs of under- or over-proofing, gumminess, crust, and shaping.
Use the recipe details if they help explain what you see, and suggest one concrete change for next time.
Answer in plain prose, 3-4 sentences at most. No headings, lists, or preamble.`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const { bakeId } = await req.json();

  // Read the bake as the signed-in user, so they can only ask about bakes they can see
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: bake, error } = await supabase.from("bakes").select("*").eq("id", bakeId).single();
  if (error) return json({ error: "Bake not found" }, 404);
  if (!bake.photo_url) return json({ error: "This bake has no crumb photo" }, 400);

  const details = [
    bake.flour && `Flour mix: ${bake.flour}`,
    bake.hydration != null && `Hydration: ${bake.hydration}%`,
    bake.recipe && `Recipe: ${JSON.stringify(bake.recipe)}`,
    bake.steps?.length && `Timeline: ${bake.steps.map((s: { stage: string; time: number }) => `${s.stage} at ${new Date(s.time).toISOString()}`).join(", ")}`,
    bake.notes && `Baker's notes: ${bake.notes}`,
  ].filter(Boolean).join("\n");

  const anthropic = new Anthropic();
  try {
    const response = await anthropic.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "url", url: bake.photo_url } },
            { type: "text", text: details ? `About this bake:\n${details}` : "What do you think of this crumb?" },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") return json({ error: "Claude declined to review this photo" }, 422);
    const opinion = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return json({ opinion });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Claude is busy right now, try again shortly" }, 429);
    if (err instanceof Anthropic.APIError) return json({ error: `Claude API error ${err.status}: ${err.message}` }, 502);
    throw err;
  }
});
