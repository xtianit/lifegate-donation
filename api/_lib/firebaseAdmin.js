// api/_lib/firebaseAdmin.js
import admin from "firebase-admin";

function getServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT env var");

  const sa = JSON.parse(raw);

  // Fix private_key newlines if needed
  if (sa.private_key && sa.private_key.includes("\\n")) {
    sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  }
  return sa;
}

export function getAdminApp() {
  if (!admin.apps.length) {
    const serviceAccount = getServiceAccount();
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id,
    });
  }
  return admin.app();
}

export function getAdminDb() {
  getAdminApp();
  return admin.firestore();
}

export function getAdmin() {
  getAdminApp();
  return admin;
}
