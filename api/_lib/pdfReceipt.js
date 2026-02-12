import PDFDocument from "pdfkit";

export function buildReceiptPdfBuffer({
  ministryName = "Life Gate Ministries Worldwide",
  campaignTitle = "Life Gate Ministries Campaign",
  name = "Anonymous",
  email = "",
  amountText = "NGN 0",
  reference = "",
  provider = "stripe",
  dateText = "",
}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks = [];

      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      // Header
      doc.fontSize(20).text(ministryName);
      doc.moveDown(0.3);
      doc.fontSize(12).fillColor("#444").text("Donation Receipt");
      doc.moveDown(1);
      doc.fillColor("#000");

      // Content
      doc.fontSize(12).text(`Campaign: ${campaignTitle}`);
      doc.moveDown(0.3);
      doc.text(`Donor Name: ${name}`);
      doc.moveDown(0.3);
      if (email) {
        doc.text(`Email: ${email}`);
        doc.moveDown(0.3);
      }
      doc.text(`Amount: ${amountText}`);
      doc.moveDown(0.3);
      doc.text(`Provider: ${String(provider).toUpperCase()}`);
      doc.moveDown(0.3);
      if (dateText) {
        doc.text(`Date: ${dateText}`);
        doc.moveDown(0.3);
      }
      doc.text(`Reference: ${reference}`);
      doc.moveDown(2);

      // Footer
      doc.fillColor("#444");
      doc.text("Thank you for your donation 🙏");
      doc.moveDown(0.4);
      doc.text("God bless you,");
      doc.text("Life Gate Ministries Worldwide");

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
