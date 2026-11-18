/* Web Push sender built only on WebCrypto (works on Cloudflare Workers, Node 20+, Deno, browsers).
   Payload encryption: RFC 8291 (aes128gcm). Sender identity: RFC 8292 (VAPID, ES256 JWT).
   No dependencies on purpose, so the code can move to another host without changes. */

const te = new TextEncoder();

export function b64u(bytes) {
  let s = "";
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(str) {
  const s = String(str).replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

/* ---------- keys ---------- */
export async function newVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { privateJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }, publicKey: b64u(pub) };
}
function rawPubToJwk(raw) {
  return { kty: "EC", crv: "P-256", x: b64u(raw.slice(1, 33)), y: b64u(raw.slice(33, 65)) };
}

/* ---------- RFC 8291 payload encryption ---------- */
// opts.asKeys / opts.salt only for tests (fixed values from the RFC test vector)
export async function encryptPayload(plaintext, p256dh, auth, opts = {}) {
  const uaPublic = typeof p256dh === "string" ? unb64u(p256dh) : p256dh;
  const authSecret = typeof auth === "string" ? unb64u(auth) : auth;
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("bad p256dh key");
  if (authSecret.length < 16) throw new Error("bad auth secret");

  let asPrivate, asPublic;
  if (opts.asKeys) {
    const pub = unb64u(opts.asKeys.publicKey);
    asPrivate = await crypto.subtle.importKey("jwk", { ...rawPubToJwk(pub), d: opts.asKeys.privateKey, ext: true },
      { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    asPublic = pub;
  } else {
    const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    asPrivate = kp.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  }
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256));

  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(te.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1]));
  const ikm = (await hmac(prkKey, keyInfo)).slice(0, 32);

  const salt = opts.salt ? unb64u(opts.salt) : crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, te.encode("Content-Encoding: aes128gcm\0\x01"))).slice(0, 16);
  const nonce = (await hmac(prk, te.encode("Content-Encoding: nonce\0\x01"))).slice(0, 12);

  const body = typeof plaintext === "string" ? te.encode(plaintext) : plaintext;
  const record = concat(body, new Uint8Array([2]));             // last record, no padding
  const rs = 4096;
  if (record.length + 16 > rs) throw new Error("payload too large");
  const aes = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, record));

  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs);
  header[20] = asPublic.length;
  return concat(header, asPublic, ct);
}

/* ---------- RFC 8292 VAPID ---------- */
const jwtCache = new Map();   // audience -> {jwt, exp}; Apple asks not to refresh more than once per hour
export async function vapidAuth(endpoint, vapid, subject, now = Math.floor(Date.now() / 1000)) {
  const aud = new URL(endpoint).origin;
  const hit = jwtCache.get(aud);
  if (hit && hit.exp - now > 3600) return `vapid t=${hit.jwt}, k=${vapid.publicKey}`;
  const exp = now + 12 * 3600;
  const head = b64u(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(te.encode(JSON.stringify({ aud, exp, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", { ...vapid.privateJwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(head + "." + claims)));
  const jwt = head + "." + claims + "." + b64u(sig);   // WebCrypto gives raw r||s, which is what JWS ES256 needs
  jwtCache.set(aud, { jwt, exp });
  return `vapid t=${jwt}, k=${vapid.publicKey}`;
}

/* ---------- send one push ---------- */
export async function sendPush(sub, payload, vapid, subject, { ttl = 86400, urgency = "high", topic } = {}) {
  const body = await encryptPayload(JSON.stringify(payload), sub.keys.p256dh, sub.keys.auth);
  const headers = {
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    "TTL": String(ttl),
    "Urgency": urgency,
    "Authorization": await vapidAuth(sub.endpoint, vapid, subject),
  };
  if (topic) headers.Topic = topic;
  const r = await fetch(sub.endpoint, { method: "POST", headers, body });
  let text = "";
  if (!r.ok) { try { text = (await r.text()).slice(0, 300); } catch (e) {} }
  return { status: r.status, ok: r.status >= 200 && r.status < 300, gone: r.status === 404 || r.status === 410, text };
}
