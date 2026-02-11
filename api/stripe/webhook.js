import { getAdminDb, getAdmin } from "../_lib/firebaseAdmin.js";
import Stripe from "stripe";

export const config = { api: { bodyParser: false } };

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers["stripe-signature"];
  const buf = await buffer(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ✅ Only handle successful payments
  if (event.type !== "checkout.session.completed") {
    return res.json({ received: true });
  }

  const session = event.data.object;

  // ---- Extract donation info ----
  const amountMinor = session.amount_total || 0;
  const currency = (session.currency || "ngn").toUpperCase();

  // You can put donor name/email in session.metadata when creating checkout session
  const name = session.customer_details?.name || session.metadata?.name || "Anonymous";
  const email = session.customer_details?.email || session.metadata?.email || null;

  const provider = "stripe";
  const reference = session.id; // e.g. cs_test_...
  const createdAt = getAdmin().firestore.FieldValue.serverTimestamp();

  const db = getAdminDb();

  // ---- Firestore locations ----
  const campaignRef = db.doc("campaigns/global");
  const donationRef = campaignRef.collection("donations").doc(reference);
  const publicRef = db.collection("publicDonations").doc(reference);

  try {
    await db.runTransaction(async (tx) => {
      const campSnap = await tx.get(campaignRef);
      const camp = campSnap.exists ? campSnap.data() : {};

      const total = Number(camp.total || 0);
      const count = Number(camp.count || 0);

      // ✅ Upsert private donation
      tx.set(
        donationRef,
        {
          name,
          email,
          amountMinor,
          currency,
          provider,
          reference,
          createdAt,
        },
        { merge: true }
      );

      // ✅ Upsert public donation (no email)
      tx.set(
        publicRef,
        {
          name,
          amountMinor,
          currency,
          provider,
          referenceShort: String(reference).slice(0, 18),
          createdAt,
        },
        { merge: true }
      );

      // ✅ Update campaign totals
      // If donation already existed, don’t double-count.
      // We check if private donation existed before:
      const oldDonSnap = await tx.get(donationRef);
      const existed = oldDonSnap.exists;

      if (!existed) {
        tx.set(
          campaignRef,
          {
            total: total + amountMinor,
            count: count + 1,
            updatedAt: createdAt,
          },
          { merge: true }
        );
      } else {
        tx.set(campaignRef, { updatedAt: createdAt }, { merge: true });
      }
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("Firestore write failed:", err);
    return res.status(500).json({ error: err.message });
  }
}

