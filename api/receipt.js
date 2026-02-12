  import { getAdminDb } from "./_lib/firebaseAdmin.js";
import { buildReceiptPdfBuffer } from "./_lib/pdfReceipt.js";

export default async function handler(req, res) {
  try {
    const ref = String(req.query.ref || "").trim();
    const t = String(req.query.t || "").trim();

    if (!ref || !t) return res.status(400).send("Missing ref or token");

    const db = getAdminDb();

    // Read from publicDonations
    const snap = await db.collection("publicDonations").doc(ref).get();
    if (!snap.exists) return res.status(404).send("Receipt not found");

    const data = snap.data() || {};

    // Token protection
    if (!data.receiptToken || data.receiptToken !== t) {
      return res.status(403).send("Invalid token");
    }

    const amountMinor = Number(data.amountMinor || 0);
    const currency = String(data.currency || "NGN").toUpperCase();
    const amountText = `${currency} ${(amountMinor / 100).toLocaleString()}`;

    const pdfBuffer = await buildReceiptPdfBuffer({
      name: data.name || "Anonymous",
      email: data.email || "", // optional
      amountText,
      reference: data.reference || ref,
      provider: data.provider || "stripe",
      campaignTitle: data.campaignTitle || "Life Gate Ministries Campaign",
      dateText: "", // optional
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="LifeGate_Receipt_${ref}.pdf"`
    );

    return res.status(200).send(pdfBuffer);
  } catch (e) {
    console.error("PDF receipt error:", e);
    return res.status(500).send("Failed to generate PDF receipt");
  }
}
