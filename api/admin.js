import admin from "firebase-admin";

function initAdmin() {
  if (admin.apps.length) return;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT env var");

  const serviceAccount = JSON.parse(raw);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

async function requireAdmin(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) throw new Error("Missing Authorization Bearer token");

  const decoded = await admin.auth().verifyIdToken(token);

  const db = admin.firestore();
  const adminDoc = await db.collection("admins").doc(decoded.uid).get();
  if (!adminDoc.exists) throw new Error("Not an admin");

  return { db, decoded };
}

export default async function handler(req, res) {
  try {
    initAdmin();

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { db, decoded } = await requireAdmin(req);

    const { action, donationId, updates, manualDonation } = req.body || {};
    const campaignRef = db.collection("campaigns").doc("global");
    const donationsCol = campaignRef.collection("donations");

    // helper: write audit log
    async function writeAudit({ action, before, after, meta }) {
      await db.collection("auditLogs").add({
        action,
        donationId: donationId || null,
        before: before || null,
        after: after || null,
        meta: meta || null,
        adminUid: decoded.uid,
        adminEmail: decoded.email || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // EDIT donation
    if (action === "edit") {
      if (!donationId || !updates) return res.status(400).json({ error: "Missing donationId or updates" });

      await db.runTransaction(async (tx) => {
        const campSnap = await tx.get(campaignRef);
        if (!campSnap.exists) throw new Error("Campaign not found");

        const donationRef = donationsCol.doc(donationId);
        const donationSnap = await tx.get(donationRef);
        if (!donationSnap.exists) throw new Error("Donation not found");

        const before = donationSnap.data();

        // Only allow editing these fields (safe list)
        const allowed = {};
        if (typeof updates.name === "string") allowed.name = updates.name;
        if (typeof updates.email === "string" || updates.email === null) allowed.email = updates.email;
        if (typeof updates.currency === "string") allowed.currency = updates.currency;

        // amountMinor edit is allowed, but must adjust totals
        let delta = 0;
        if (typeof updates.amountMinor === "number" && updates.amountMinor >= 0) {
          delta = updates.amountMinor - (before.amountMinor || 0);
          allowed.amountMinor = updates.amountMinor;
        }

        allowed.updatedAt = admin.firestore.FieldValue.serverTimestamp();

        const camp = campSnap.data();
        tx.update(campaignRef, {
          total: (camp.total || 0) + delta,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        tx.update(donationRef, allowed);

        // audit: store before/after
        tx.set(db.collection("auditLogs").doc(), {
          action: "edit",
          donationId,
          before,
          after: { ...before, ...allowed, amountMinor: allowed.amountMinor ?? before.amountMinor },
          adminUid: decoded.uid,
          adminEmail: decoded.email || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      return res.json({ ok: true });
    }

    // DELETE donation
    if (action === "delete") {
      if (!donationId) return res.status(400).json({ error: "Missing donationId" });

      await db.runTransaction(async (tx) => {
        const campSnap = await tx.get(campaignRef);
        if (!campSnap.exists) throw new Error("Campaign not found");

        const donationRef = donationsCol.doc(donationId);
        const donationSnap = await tx.get(donationRef);
        if (!donationSnap.exists) throw new Error("Donation not found");

        const before = donationSnap.data();
        const camp = campSnap.data();

        tx.update(campaignRef, {
          total: (camp.total || 0) - (before.amountMinor || 0),
          count: Math.max((camp.count || 0) - 1, 0),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        tx.delete(donationRef);

        tx.set(db.collection("auditLogs").doc(), {
          action: "delete",
          donationId,
          before,
          after: null,
          adminUid: decoded.uid,
          adminEmail: decoded.email || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      return res.json({ ok: true });
    }

    // MANUAL ADD donation (bank transfer/offline)
    if (action === "manual_add") {
      if (!manualDonation) return res.status(400).json({ error: "Missing manualDonation" });

      const { name, email, amountMinor, currency } = manualDonation;
      if (!amountMinor || amountMinor <= 0) return res.status(400).json({ error: "Invalid amountMinor" });

      const newRef = donationsCol.doc();
      const now = admin.firestore.FieldValue.serverTimestamp();

      await db.runTransaction(async (tx) => {
        const campSnap = await tx.get(campaignRef);
        if (!campSnap.exists) throw new Error("Campaign not found");

        const camp = campSnap.data();

        const donationData = {
          provider: "manual",
          name: name || "Anonymous",
          email: email || null,
          amountMinor,
          currency: (currency || "NGN").toUpperCase(),
          reference: `manual_${newRef.id}`,
          status: "success",
          createdAt: now,
          updatedAt: now,
        };

        tx.set(newRef, donationData);

        tx.update(campaignRef, {
          total: (camp.total || 0) + amountMinor,
          count: (camp.count || 0) + 1,
          updatedAt: now,
        });

        tx.set(db.collection("auditLogs").doc(), {
          action: "manual_add",
          donationId: newRef.id,
          before: null,
          after: donationData,
          adminUid: decoded.uid,
          adminEmail: decoded.email || null,
          createdAt: now,
        });
      });

      return res.json({ ok: true });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (e) {
    return res.status(401).json({ error: e.message || "Unauthorized" });
  }
}
