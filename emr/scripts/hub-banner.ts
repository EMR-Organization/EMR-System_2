// Printed by start-hub when the EMR is up: the address everyone opens, as text
// and as a QR code to scan with a phone camera.
//
//   node tools/hub-banner.mjs <main address> [other addresses...]
import QRCode from "qrcode";

async function main() {
  const [main, ...others] = process.argv.slice(2);
  if (!main) throw new Error("Usage: hub-banner <address> [other addresses...]");
  const qr = await QRCode.toString(main, { type: "terminal", small: true, errorCorrectionLevel: "M" });
  const line = "=".repeat(64);
  console.log(`\n${line}\n  HF EMR is running. On every phone, tablet and laptop, open:\n\n      ${main}\n`);
  for (const o of others) console.log(`  or  ${o}`);
  console.log(`\n${qr}`);
  console.log(`  First time on a device? Open ${new URL("/setup", main)} to install the certificate.`);
  console.log(`  Keep this window open. To stop the EMR, close it or run stop.bat.\n${line}\n`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
