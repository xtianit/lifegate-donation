// api/_lib/brevo.js
export async function sendBrevoEmailReceipt({ toEmail, toName, subject, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || "Life Gate Ministries";

  if (!apiKey) throw new Error("Missing BREVO_API_KEY");
  if (!senderEmail) throw new Error("Missing BREVO_SENDER_EMAIL");

  const payload = {
    sender: { email: senderEmail, name: senderName },
    to: [{ email: toEmail, name: toName || toEmail }],
    subject,
    htmlContent: html,
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
    // ignore if Brevo response isn't JSON
  }

  if (!r.ok) {
    throw new Error(data?.message || "Brevo email failed");
  }

  return data; // contains messageId
}
