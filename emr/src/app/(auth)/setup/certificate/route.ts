import { connection } from "next/server";
import { rootCertificate } from "@/server/setup-cert";

// The hub's root certificate for devices to install (see /setup). DER, which
// iOS, Android and Windows all accept from a download.
export async function GET() {
  await connection();
  const cert = await rootCertificate();
  if (!cert) return new Response("Not available on this computer.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(new Uint8Array(cert.der), {
    headers: {
      "Content-Type": "application/x-x509-ca-cert",
      "Content-Disposition": 'attachment; filename="hf-emr-root.crt"',
      "Cache-Control": "no-store",
    },
  });
}
