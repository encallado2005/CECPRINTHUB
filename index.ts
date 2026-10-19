// CECPRINTHUB private-file gateway.
// Verifies Firebase ID tokens with Firebase Auth, then accesses the private
// Supabase Storage bucket using a server-side secret (never expose that secret).
const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const MAX_BYTES = 20 * 1024 * 1024;
const ADMIN_EMAIL = (Deno.env.get("ADMIN_EMAIL") ?? "janry@gmail.com").toLowerCase();

async function firebaseUser(req: Request) {
  const header = req.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Sign in first; Firebase ID token is missing.");
  const apiKey = Deno.env.get("FIREBASE_WEB_API_KEY");
  if (!apiKey) throw new Error("Server setup incomplete: FIREBASE_WEB_API_KEY is missing.");
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: match[1] }),
  });
  if (!response.ok) throw new Error("Firebase session is invalid or expired. Please sign in again.");
  const payload = await response.json();
  const user = payload.users?.[0];
  if (!user?.localId || !user?.email) throw new Error("Firebase account could not be verified.");
  return { uid: String(user.localId), email: String(user.email).toLowerCase() };
}
function safeName(input: string) {
  const cleaned = input.split(/[\\/]/).pop()!.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120);
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : "print-file";
}
function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Server setup incomplete: ${name} is missing.`);
  return value;
}
async function storageRequest(path: string, init: RequestInit) {
  const base = env("SUPABASE_URL").replace(/\/$/, "");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  return await fetch(`${base}/storage/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
  });
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const user = await firebaseUser(req);
    const body = await req.json();
    const action = String(body.action ?? "");
    const bucket = env("SUPABASE_BUCKET");
    if (action === "upload") {
      if (!(body.fileBase64 && body.fileName && body.orderId)) return json({ error: "fileBase64, fileName, and orderId are required." }, 400);
      const orderId = String(body.orderId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
      if (!orderId) return json({ error: "Invalid order ID." }, 400);
      const binary = atob(String(body.fileBase64));
      if (binary.length > MAX_BYTES) return json({ error: "File exceeds the 20 MB limit." }, 413);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const filename = safeName(String(body.fileName));
      const objectPath = `${user.uid}/${orderId}/${crypto.randomUUID()}-${filename}`;
      const contentType = String(body.contentType ?? "application/octet-stream").slice(0, 120);
      const result = await storageRequest(`object/${encodeURIComponent(bucket)}/${objectPath.split('/').map(encodeURIComponent).join('/')}`, {
        method: "POST", headers: { "Content-Type": contentType, "x-upsert": "false" }, body: bytes,
      });
      if (!result.ok) return json({ error: `Storage upload failed (${result.status}).` }, 502);
      return json({ ok: true, path: objectPath, fileName: filename, contentType, size: bytes.length });
    }
    if (action === "download-url" || action === "delete") {
      const path = String(body.path ?? "");
      if (!path || path.startsWith("/") || path.includes("..")) return json({ error: "Invalid file path." }, 400);
      const ownerUid = path.split("/")[0];
      if (user.uid !== ownerUid && user.email !== ADMIN_EMAIL) return json({ error: "You are not allowed to access this file." }, 403);
      if (action === "download-url") {
        const response = await storageRequest(`object/sign/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 300 }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) return json({ error: "Could not create a file download link." }, 502);
        const signed = result.signedURL ?? result.signedUrl ?? result.signed_url;
        return json({ ok: true, url: signed?.startsWith("http") ? signed : `${env("SUPABASE_URL")}/storage/v1${signed}` });
      }
      if (user.email !== ADMIN_EMAIL) return json({ error: "Only the configured admin can delete uploaded files." }, 403);
      const response = await storageRequest(`object/${encodeURIComponent(bucket)}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [path] }),
      });
      if (!response.ok) return json({ error: "Could not delete the file." }, 502);
      return json({ ok: true });
    }
    return json({ error: "Unknown action. Use upload, download-url, or delete." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected server error." }, 401);
  }
});
