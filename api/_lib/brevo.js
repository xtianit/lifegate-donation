// api/_lib/brevo.js

export function buildDonationReceiptHtml({
  name = "Anonymous",
  amountText = "NGN 0",
  reference = "",
  provider = "stripe",
  dateText = "",
  campaignTitle = "Life Gate Ministries Campaign",
}) {
  return `
  <div style="background:#f6f7f9;padding:24px;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e8e8e8;">
      
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#0f1419 0%, #1a472a 100%);padding:26px 24px;">
        <div style="font-size:22px;font-weight:800;color:#d4af37;letter-spacing:0.4px;">
          Life Gate Ministries Worldwide
        </div>
        <div style="margin-top:6px;font-size:13px;color:rgba(255,255,255,0.85);">
          Donation Receipt
        </div>
      </div>

      <!-- Body -->
      <div style="padding:22px 24px;color:#111;">
        <h2 style="margin:0 0 10px 0;font-size:18px;color:#1a472a;">
          Thank you for your donation 🙏
        </h2>

        <div style="font-size:13px;color:#444;line-height:1.6;margin-bottom:16px;">
          Your generosity helps us transform lives. Below is your receipt for this donation.
        </div>

        <!-- Receipt card -->
        <div style="border:1px solid #eee;border-radius:12px;padding:14px 14px;background:#fbfbfc;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr>
              <td style="padding:8px 0;color:#555;width:160px;">Donor Name</td>
              <td style="padding:8px 0;font-weight:700;color:#111;">${escapeHtml(name)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#555;">Campaign</td>
              <td style="padding:8px 0;font-weight:600;color:#111;">${escapeHtml(campaignTitle)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#555;">Amount</td>
              <td style="padding:8px 0;font-weight:800;color:#1a472a;font-size:16px;">${escapeHtml(amountText)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#555;">Provider</td>
              <td style="padding:8px 0;font-weight:600;color:#111;text-transform:uppercase;">
                ${escapeHtml(provider)}
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#555;">Date</td>
              <td style="padding:8px 0;color:#111;">${escapeHtml(dateText || "—")}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#555;">Reference</td>
              <td style="padding:8px 0;font-family:Consolas,monospace;color:#111;word-break:break-all;">
                ${escapeHtml(reference)}
              </td>
            </tr>
          </table>
        </div>

        <!-- Footer note -->
        <div style="margin-top:16px;font-size:13px;color:#444;line-height:1.6;">
          If you have any questions about this receipt, please reply to this email.
        </div>

        <div style="margin-top:18px;font-size:14px;color:#111;">
          God bless you,<br/>
          <strong style="color:#1a472a;">Life Gate Ministries Worldwide</strong>
        </div>
      </div>

      <!-- Bottom bar -->
      <div style="background:#0f1419;padding:14px 24px;color:rgba(255,255,255,0.75);font-size:12px;">
        © ${new Date().getFullYear()} Life Gate Ministries Worldwide · All rights reserved
      </div>

    </div>
  </div>
  `;
}

function escapeHtml(str){
  return String(str || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/**
 * Sends email via Brevo SMTP API.
 * Requires env vars:
 * - BREVO_API_KEY
 * - BREVO_SENDER_EMAIL
 * - BREVO_SENDER_NAME (optional)
 */
export async function sendBrevoEmailReceipt({ toEmail, toName, subject, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || "Life Gate Ministries";

  if (!apiKey) throw new Error("Missing BREVO_API_KEY");
  if (!senderEmail) throw new Error("Missing BREVO_SENDER_EMAIL");
  if (!toEmail) throw new Error("Missing toEmail");

  const payload = {
    sender: { email: senderEmail, name: senderName },
    to: [{ email: toEmail, name: toName || toEmail }],
    subject: subject || "Donation Receipt — Life Gate Ministries",
    htmlContent: html || "<p>Thank you for your donation.</p>",
  };

  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  let data = {};
  try {
    data = await r.json();
  } catch {
    // ignore non-json
  }

  if (!r.ok) {
    throw new Error(data?.message || "Brevo email failed");
  }

  return data;
}
