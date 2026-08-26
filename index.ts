// supabase/functions/create-checkout-stripe/index.ts
// Crée une session de paiement Stripe.
// Deux modes possibles :
//   - mode="department" (par défaut) : achat d'UN département (comportement existant)
//   - mode="france" : achat de la France ENTIÈRE au prix courant (double après chaque achat)
// Le prix est TOUJOURS relu en base, jamais fait confiance au navigateur.

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17?target=denonext";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { name, url, color } = body;
    const mode = body.mode === "france" ? "france" : "department";

    if (!name) {
      return new Response(JSON.stringify({ error: "name requis" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const siteUrl = (Deno.env.get("SITE_URL") ?? "https://terterr.com").replace(/\/$/, "");
    let amountInCents: number;
    let productName: string;
    let productDescription: string;
    let metadata: Record<string, string>;

    if (mode === "france") {
      const { data: wc, error } = await supabase
        .from("world_conquest")
        .select("price")
        .eq("id", 1)
        .single();

      if (error || !wc) {
        return new Response(JSON.stringify({ error: "Prix de la France introuvable" }), {
          status: 404,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      amountInCents = Math.round(Number(wc.price) * 100);
      productName = "Conquête de la France entière";
      productDescription = "Tous les départements deviennent tiens en une seule fois. Le prix double après chaque conquête totale.";
      metadata = {
        type: "france",
        invader_name: String(name).slice(0, 40),
        invader_url: url ? String(url).slice(0, 200) : "",
        invader_color: color || "#ff7a29",
      };
    } else {
      const { code } = body;
      if (!code) {
        return new Response(JSON.stringify({ error: "code requis" }), {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      const { data: dept, error } = await supabase
        .from("departments")
        .select("price, nom")
        .eq("code", code)
        .single();

      if (error || !dept) {
        return new Response(JSON.stringify({ error: "Département introuvable" }), {
          status: 404,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      amountInCents = Math.round(Number(dept.price) * 100);
      productName = `Invasion de ${dept.nom}`;
      productDescription = "Visibilité sur le site. Chaque euro versé s'ajoute au total affiché. Aucun tirage, aucun gain : de la visibilité, c'est tout.";
      metadata = {
        type: "department",
        dept_code: String(code),
        invader_name: String(name).slice(0, 40),
        invader_url: url ? String(url).slice(0, 200) : "",
        invader_color: color || "#ff7a29",
      };
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      allow_promotion_codes: true,
      line_items: [
        {
          price_data: {
            currency: "eur",
            unit_amount: amountInCents,
            product_data: {
              name: productName,
              description: productDescription,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${siteUrl}/?status=succeeded`,
      cancel_url: `${siteUrl}/`,
      metadata,
    });

    return new Response(JSON.stringify({ checkout_url: session.url }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: "Erreur serveur" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
