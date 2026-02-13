import express from "express";
import cors from "cors";
import axios from "axios";
import bodyParser from "body-parser";
import Stripe from "stripe";
import admin from "firebase-admin";
import crypto from "crypto";

const app = express();

/**
 * Vercel NOTE:
 * - Do NOT use app.listen()
 * - Secrets must be in Vercel Environment Variables
 * - For webhooks, we need RAW body (Buffer)
 */

app.use(cors());

// ✅ Only parse JSON for NON-webhook routes
app.use((req, res, next) => {
  if (req.path === "/api/stripe/webhook" || req.path === "/api/paystack/webhook") return next();
  return express.json()(req, res, next);
});

// ====== ENV VARS (set in Vercel Dashboard) ======
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL; // e.g. https://yourdomain.com

// Firebase service account JSON stored in env var
// (paste full JSON as string in Vercel ENV)
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();
const campaignRef = db.collection("campaigns").doc("global");
const stripe = new Stripe(STRIPE_SECRET_KEY);

// ====== 1. INITIALIZE CAMPAIGN DOCUMENT ======
async function ensureCampaign() {
  const doc = await campaignRef.get();
  if (!doc.exists) {
    await campaignRef.set({
      total: 0,
      count: 0,
      goal: 100000000, // in kobo (₦1,000,000)
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
}

// ====== 2. RECORD DONATION ======
async function recordDonation({ provider, amountMinor, currency, name, email, reference }) {
  await ensureCampaign();

  // ✅ Use increment to avoid race conditions
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(campaignRef);
    if (!snap.exists) throw new Error("Campaign document 'global' not found");

    // Optional: prevent duplicates by storing donation doc by reference
    const donationRef = campaignRef.collection("donations").doc(reference);

    const donationSnap = await tx.get(donationRef);
    if (donationSnap.exists && donationSnap.data()?.status === "success") {
      return; // already counted
    }

    tx.set(
      donationRef,
      {
        provider,
        amountMinor,
        currency,
        name: name || "Anonymous",
        email: email || null,
        reference,
        status: "success",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.update(campaignRef, {
      total: admin.firestore.FieldValue.increment(amountMinor),
      count: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  console.log(`✅ Donation recorded: ${currency} ${amountMinor / 100} from ${name || "Anonymous"}`);
}

// ====== 3. ROUTES ======

app.get("/api", (req, res) => {
  res.json({
    status: "ok",
    message: "Life Gate Ministries Donation API (Vercel)",
    endpoints: {
      stripe: "/api/stripe/start",
      paystack: "/api/paystack/start",
      stats: "/api/stats",
      donations: "/api/donations",
      webhooks: {
        stripe: "/api/stripe/webhook",
        paystack: "/api/paystack/webhook",
      },
    },
  });
});

// Get stats
app.get("/api/stats", async (req, res) => {
  try {
    await ensureCampaign();
    const doc = await campaignRef.get();
    res.json(doc.data());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get recent donations
app.get("/api/donations", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const snapshot = await campaignRef
      .collection("donations")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    const donations = snapshot.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
      };
    });

    res.json({ donations });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Stripe start
app.post("/api/stripe/start", async (req, res) => {
  try {
    const { amountMajor, currency, name, email } = req.body;

    if (!amountMajor || amountMajor <= 0) return res.status(400).json({ error: "Invalid amount" });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: (currency || "USD").toLowerCase(),
            product_data: { name: "Life Gate Ministries Donation" },
            unit_amount: Math.round(amountMajor * 100),
          },
          quantity: 1,
        },
      ],

      //New paste
      //ENd of new paster
      
      metadata: {
        donor_name: name || "Anonymous",
        donor_email: email || "",
      },
      customer_email: email,

      
      success_url: `${FRONTEND_URL}/index.html?success=1&provider=stripe`,
      cancel_url: `${FRONTEND_URL}/index.html?cancel=1`,
    });

    console.log(`📧 Stripe session created: ${session.id}`);
    res.json({ url: session.url });
  } catch (e) {
    console.error("❌ Stripe error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Paystack start
app.post("/api/paystack/start", async (req, res) => {
  try {
    const { amountMajor, currency, name, email } = req.body;

    if (!amountMajor || amountMajor <= 0) return res.status(400).json({ error: "Invalid amount" });
    if (!email) return res.status(400).json({ error: "Email is required for Paystack" });

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: Math.round(amountMajor * 100),
        currency: currency || "NGN",
        metadata: { donor_name: name || "Anonymous" },
        callback_url: `${FRONTEND_URL}/index.html?success=1&provider=paystack`,
      },
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
    );

    console.log(`📧 Paystack transaction created: ${response.data.data.reference}`);
    res.json({ url: response.data.data.authorization_url });
  } catch (e) {
    console.error("❌ Paystack error:", e.response?.data || e.message);
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

// ====== 4. WEBHOOKS ======

// Stripe webhook (RAW)
app.post("/api/stripe/webhook", bodyParser.raw({ type: "application/json" }), async (req, res) => {
  try {
    const sig = req.headers["stripe-signature"];
    const event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);

    console.log(`🔔 Stripe webhook received: ${event.type}`);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      // await recordDonation({
      //   provider: "stripe",
      //   amountMinor: session.amount_total,
      //   currency: session.currency?.toUpperCase(),
      //   name: session.metadata?.donor_name,
      //   email: session.customer_email || session.metadata?.donor_email,
      //   reference: session.id,
      // });
      await recordDonation({
        provider: "stripe",
        amountMinor: Number(session.amount_total || 0),
        currency: String(session.currency || "usd").toUpperCase(),
        name: session.metadata?.donor_name || session.customer_details?.name || "Anonymous",
        email: session.customer_email || session.metadata?.donor_email || session.customer_details?.email || null,
        reference: session.id,
      });

    }

    res.json({ received: true });
  } catch (e) {
    console.error("❌ Stripe webhook error:", e.message);
    res.status(400).send(e.message);
  }
});

// Paystack webhook (RAW)
app.post("/api/paystack/webhook", bodyParser.raw({ type: "*/*" }), async (req, res) => {
  try {
    const rawBody = req.body; // Buffer
    const signature = req.headers["x-paystack-signature"];

    const hash = crypto.createHmac("sha512", PAYSTACK_SECRET_KEY).update(rawBody).digest("hex");

    if (hash !== signature) {
      console.error("❌ Invalid Paystack signature");
      return res.sendStatus(400);
    }

    const payload = JSON.parse(rawBody.toString("utf8"));
    console.log(`🔔 Paystack webhook received: ${payload.event}`);

    if (payload.event === "charge.success") {
      const data = payload.data;
      await recordDonation({
        provider: "paystack",
        amountMinor: data.amount,
        currency: data.currency,
        name: data.metadata?.donor_name,
        email: data.customer?.email,
        reference: data.reference,
      });
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("❌ Paystack webhook error:", e.message);
    res.status(500).send(e.message);
  }
});

export default app;
