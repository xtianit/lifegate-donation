import { getAdminDb, getAdmin } from "../_lib/firebaseAdmin.js";
import Stripe from "stripe";

export const config = { api: { bodyParser: false } };

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // ✅ Stripe init (requires STRIPE_SECRET_KEY in Vercel env)
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers["stripe-signature"];
  const buf = await buffer(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ✅ Only handle successful payments
  if (event.type !== "checkout.session.completed") {
    return res.json({ received: true });
  }

  const session = event.data.object;

  // ---- Extract donation info ----
  const amountMinor = Number(session.amount_total || 0);
  const currency = String(session.currency || "ngn").toUpperCase();

  const name =
    session.customer_details?.name ||
    session.metadata?.name ||
    "Anonymous";

  const email =
    session.customer_details?.email ||
    session.metadata?.email ||
    null;

  const provider = "stripe";
  const reference = session.id; // e.g. cs_test_...

  // ✅ Firebase Admin FieldValue
  const Admin = getAdmin();
  const FieldValue = Admin.firestore.FieldValue;

  const db = getAdminDb();

  // ---- Firestore locations ----
  const campaignRef = db.doc("campaigns/global");
  const donationRef = campaignRef.collection("donations").doc(reference);
  const publicRef = db.collection("publicDonations").doc(reference);

  try {
    await db.runTransaction(async (tx) => {
      // ✅ 1) READS FIRST
      const campSnap = await tx.get(campaignRef);
      if (!campSnap.exists) throw new Error("Campaign doc not found");

      const camp = campSnap.data() || {};
      const prevTotal = Number(camp.total || 0);
      const prevCount = Number(camp.count || 0);

      const newTotal = prevTotal + amountMinor;
      const newCount = prevCount + 1;

      // ✅ 2) THEN WRITES
      tx.update(campaignRef, {
        total: newTotal,
        count: newCount,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Admin-only donation record
      tx.set(
        donationRef,
        {
          provider,
          amountMinor,
          currency,
          name,
          email,
          reference,
          status: "success",
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // Public donation record (readable by homepage)
      tx.set(
        publicRef,
        {
          provider,
          amountMinor,
          currency,
          name,
          reference,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("Firestore write failed:", err);
    return res.status(500).json({ error: err.message });
  }
}
