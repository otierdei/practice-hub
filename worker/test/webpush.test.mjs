// node worker/test/webpush.test.mjs   (Node 20+, no dependencies)
import assert from "node:assert/strict";
import { encryptPayload, b64u, unb64u, newVapidKeys, vapidAuth } from "../src/webpush.js";

// 1. RFC 8291 Appendix A test vector: our encryption must give the exact body from the RFC
const expected = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
  "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
  "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";
const out = await encryptPayload(
  unb64u("V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24"),
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  "BTBZMqHH6r4Tts7J_aSIgg",
  { salt: "DGv6ra1nlYgDCS1FRnbzlw",
    asKeys: { privateKey: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
              publicKey: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8" } });
assert.equal(b64u(out), expected);
console.log("ok  RFC 8291 test vector matches byte for byte");

// 2. VAPID JWT: signature verifies with the public key, claims are right
const v = await newVapidKeys();
const auth = await vapidAuth("https://web.push.apple.com/abc", v, "https://otierdei.github.io/coach-app/", 1_000_000);
const m = auth.match(/^vapid t=([^,]+), k=(.+)$/);
assert.ok(m, "header shape");
const [h, c, s] = m[1].split(".");
const claims = JSON.parse(new TextDecoder().decode(unb64u(c)));
assert.equal(claims.aud, "https://web.push.apple.com");
assert.equal(claims.exp, 1_000_000 + 12 * 3600);
const pub = await crypto.subtle.importKey("raw", unb64u(m[2]), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, unb64u(s), new TextEncoder().encode(h + "." + c)));
console.log("ok  VAPID JWT signature verifies, aud and exp correct");

// 3. Round trip with a random browser key: decrypt like a browser would
const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const uaPub = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
const secret = crypto.getRandomValues(new Uint8Array(16));
const msg = JSON.stringify({ title: "Morning briefing", body: "Test äöü 💪" });
const enc = await encryptPayload(msg, b64u(uaPub), b64u(secret));
// decrypt (receiver side of RFC 8291)
const salt = enc.slice(0, 16), idlen = enc[20], asPub = enc.slice(21, 21 + idlen), ct = enc.slice(21 + idlen);
const hm = async (k, d) => new Uint8Array(await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", k, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), d));
const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
const te = new TextEncoder();
const prkKey = await hm(secret, ecdh);
const ikm = await hm(prkKey, new Uint8Array([...te.encode("WebPush: info\0"), ...uaPub, ...asPub, 1]));
const prk = await hm(salt, ikm);
const cek = (await hm(prk, te.encode("Content-Encoding: aes128gcm\0\x01"))).slice(0, 16);
const nonce = (await hm(prk, te.encode("Content-Encoding: nonce\0\x01"))).slice(0, 12);
const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), ct));
assert.equal(pt[pt.length - 1], 2);
assert.equal(new TextDecoder().decode(pt.slice(0, -1)), msg);
console.log("ok  round trip: a browser key decrypts the payload (umlauts and emoji intact)");

// 4. speed: rough local timing of one full encrypt + sign (Workers bill CPU, this is only an indication)
const t0 = performance.now();
for (let i = 0; i < 20; i++) await encryptPayload(msg, b64u(uaPub), b64u(secret));
console.log("info local encrypt time per push: " + ((performance.now() - t0) / 20).toFixed(2) + " ms");
