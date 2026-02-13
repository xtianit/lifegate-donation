// api/stripe/webhook.js
import { getAdminDb, getAdmin } from "../_lib/firebaseAdmin.js";
import { sendBrevoEmailReceipt, buildDonationReceiptHtml } from "../_lib/brevo.js";
import Stripe from "stripe";
import crypto from "crypto";

export const config = { api: { bodyParser: false } };

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function makeReceiptToken() {
  return crypto.randomBytes(24).toString("hex");
}

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });
    }
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(500).json({ error: "Missing STRIPE_WEBHOOK_SECRET" });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
    const reference = session.id;

    const receiptToken = makeReceiptToken();

   

    const Admin = getAdmin();
    const FieldValue = Admin.firestore.FieldValue;
    const db = getAdminDb();

    const campaignRef = db.doc("campaigns/global");
    const donationRef = campaignRef.collection("donations").doc(reference);
    const publicRef = db.collection("publicDonations").doc(reference);

    const dateText = new Date().toLocaleString("en-GB", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });


    //-----------------------------
    //Receipt token generator
    //==============================
    // ---- before transaction ----
    let tokenToUse = null;
    
    // ----------------------------
    // Firestore transaction
    // ----------------------------
    await db.runTransaction(async (tx) => {
      const campSnap = await tx.get(campaignRef);
      if (!campSnap.exists) throw new Error("Campaign doc not found");
    
      const existingDonationSnap = await tx.get(donationRef);
      const alreadyProcessed = existingDonationSnap.exists;
    
      // ✅ Token handling (reuse if already exists)
      const existingData = existingDonationSnap.exists ? (existingDonationSnap.data() || {}) : {};
      tokenToUse = existingData.receiptToken || makeReceiptToken();
    
      // Only add totals once
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
          receiptToken: tokenToUse, // ✅ stable token
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
    
    // ✅ build download url AFTER transaction so tokenToUse is correct
    const baseUrl = process.env.PUBLIC_BASE_URL || getBaseUrl(req);
    const downloadUrl =
      `${baseUrl}/api/receipt?ref=${encodeURIComponent(reference)}&t=${encodeURIComponent(tokenToUse)}`;









    

    // ----------------------------
    // Email receipt via Brevo
    // ----------------------------
    if (email) {
      const amountText = `${currency} ${(amountMinor / 100).toLocaleString()}`;

      const html =
        buildDonationReceiptHtml({
          name,
          amountText,
          reference,
          provider,
          dateText,
          campaignTitle: "Life Gate Ministries Campaign",
        }) +
        `
        <div style="max-width:640px;margin:14px auto 0 auto;font-family:Arial,sans-serif;">
          <a href="${downloadUrl}" style="display:inline-block;padding:12px 16px;border-radius:10px;background:#1a472a;color:#fff;text-decoration:none;font-weight:700;">
            Download PDF Receipt
          </a>

          <p style="margin-top:12px;color:#333;font-size:13px;">
            If the button doesn’t work, copy this link:
            <br />
            <a href="${downloadUrl}">${downloadUrl}</a>
          </p>
        </div>
      `;

      try {
        await sendBrevoEmailReceipt({
          toEmail: email,
          toName: name,
          subject: "Donation Receipt — Life Gate Ministries",
          html,
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
