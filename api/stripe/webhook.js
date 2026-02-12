// api/stripe/webhook.js
import { getAdminDb, getAdmin } from "../_lib/firebaseAdmin.js";
import { sendBrevoEmailReceipt } from "../_lib/brevo.js";
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

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(500).json({ error: "Missing STRIPE_WEBHOOK_SECRET" });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // stripe-signature might be string or array depending on server
  const sigHeader = req.headers["stripe-signature"];
  const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;

  const buf = await buffer(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Only handle successful checkout
  if (event.type !== "checkout.session.completed") {
    return res.json({ received: true });
  }

  const session = event.data.object;

  // Extract donation information
  const amountMinor = Number(session.amount_total || 0);
  const currency = String(session.currency || "ngn").toUpperCase();

  const name = session.customer_details?.name || session.metadata?.name || "Anonymous";
  const email = session.customer_details?.email || session.metadata?.email || null;

  const provider = "stripe";
  const reference = session.id; // unique per checkout session

  const Admin = getAdmin();
  const FieldValue = Admin.firestore.FieldValue;
  const db = getAdminDb();

  const campaignRef = db.doc("campaigns/global");
  const donationRef = campaignRef.collection("donations").doc(reference);
  const publicRef = db.collection("publicDonations").doc(reference);

  try {
    await db.runTransaction(async (tx) => {
      // ✅ 1) READS FIRST
      const campSnap = await tx.get(campaignRef);
      if (!campSnap.exists) throw new Error("Campaign doc not found");

      // ✅ IMPORTANT: check if donation already processed (Stripe retries webhooks)
      const existingDonationSnap = await tx.get(donationRef);
      const alreadyProcessed = existingDonationSnap.exists;

      // If already processed, do NOT add totals again.
      if (!alreadyProcessed) {
        const camp = campSnap.data() || {};
        const prevTotal = Number(camp.total || 0);
        const prevCount = Number(camp.count || 0);

        tx.update(campaignRef, {
          total: prevTotal + amountMinor,
          count: prevCount + 1,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      // Always upsert donation docs (safe)
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

    // Send email receipt (do NOT fail webhook if email fails)
    if (email) {
      try {
        await sendBrevoEmailReceipt({
          toEmail: email,
          toName: name,
          subject: "Donation Receipt — Life Gate Ministries",
          html: `
            <div style="font-family:Arial,sans-serif;line-height:1.6">
              <h2>Thank you for your donation 🙏</h2>
              <p><b>Name:</b> ${name}</p>
              <p><b>Amount:</b> ${currency} ${(amountMinor / 100).toLocaleString()}</p>
              <p><b>Reference:</b> ${reference}</p>
              <p>Your generosity helps us transform lives.</p>
              <br/>
              <p>God bless you,<br/>Life Gate Ministries</p>
            </div>
          `,
        });
      } catch (emailErr) {
        console.error("Brevo email failed:", emailErr);
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("Stripe webhook failed:", err);
    return res.status(500).json({ error: err.message });
  }
}
