// Printed by start-hub when the EMR is up: the address everyone opens, as text
// and as a QR code to scan with a phone camera, plus the certificate's
// fingerprint, which people compare with the one on /setup before installing it
// (so a laptop imitating the hub can't slip them its own certificate).
//
//   node tools/hub-banner.mjs <main address> [other addresses...]
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import QRCode from "qrcode";

function rootFingerprint(): string | null {
  const file = process.env.CADDY_ROOT_CERT;
  if (!file) return null;
  try {
    return new X509Certificate(readFileSync(file)).fingerprint256;
  } catch {
    return null;
  }
}

async function main() {
  const [main, ...others] = process.argv.slice(2);
  if (!main) throw new Error("Usage: hub-banner <address> [other addresses...]");
  const qr = await QRCode.toString(main, { type: "terminal", small: true, errorCorrectionLevel: "M" });
  const line = "=".repeat(64);
  console.log(`\n${line}\n  HF EMR is running. On every phone, tablet and laptop, open:\n\n      ${main}\n`);
  for (const o of others) console.log(`  or  ${o}`);
  console.log(`\n${qr}`);
  console.log(`  First time on a device? Open ${new URL("/setup", main)} to install the certificate.`);
  const fingerprint = rootFingerprint();
  if (fingerprint) console.log(`  Check the page shows this fingerprint before installing it:\n      ${fingerprint}`);
  console.log(`  Keep this window open. To stop the EMR, close it or run stop.bat.\n${line}\n`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
