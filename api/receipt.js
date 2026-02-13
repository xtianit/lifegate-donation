// api/receipt.js
import { getAdminDb } from "./_lib/firebaseAdmin.js";
import PDFDocument from "pdfkit";

function moneyText(currency, amountMinor) {
  const amt = Number(amountMinor || 0) / 100;
  return `${String(currency || "NGN").toUpperCase()} ${amt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function handler(req, res) {
  try {
    const ref = String(req.query.ref || "").trim();
    const t = String(req.query.t || "").trim();

    if (!ref || !t) {
      return res.status(400).send("Missing ref or token");
    }

    const db = getAdminDb();

    // ✅ IMPORTANT: must match where webhook stored receiptToken
    const donationDoc = await db.doc(`campaigns/global/donations/${ref}`).get();

    if (!donationDoc.exists) {
      return res.status(404).send("Receipt not found");
    }

    const d = donationDoc.data() || {};
    if (!d.receiptToken || d.receiptToken !== t) {
      return res.status(403).send("Invalid token");
    }

    // Build PDF
    const doc = new PDFDocument({ size: "A4", margin: 50 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="receipt_${ref}.pdf"`);

    doc.pipe(res);

    // Header
    doc.fontSize(20).text("Life Gate Ministries Worldwide", { align: "left" });
    doc.moveDown(0.3);
    doc.fontSize(14).text("Donation Receipt", { align: "left" });
    doc.moveDown(1);

    // Body
    doc.fontSize(12);
    doc.text(`Donor Name: ${d.name || "Anonymous"}`);
    doc.text(`Email: ${d.email || "—"}`);
    doc.text(`Provider: ${(d.provider || "stripe").toUpperCase()}`);
    doc.text(`Amount: ${moneyText(d.currency, d.amountMinor)}`);
    doc.text(`Reference: ${d.reference || ref}`);
    doc.text(`Status: ${d.status || "success"}`);

    doc.moveDown(1);

    const createdAt = d.createdAt?.toDate?.() ? d.createdAt.toDate().toLocaleString() : "";
    doc.text(`Date: ${createdAt || new Date().toLocaleString()}`);

    doc.moveDown(2);
    doc.text("Thank you for your donation 🙏");
    doc.moveDown(0.5);
    doc.text("God bless you,", { continued: false });
    doc.text("Life Gate Ministries Worldwide");

    doc.end();
  } catch (err) {
    console.error("Receipt error:", err);
    return res.status(500).send("Receipt generation failed");
  }
}
