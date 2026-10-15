import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { Toaster } from "@/components/ui/sonner";
import { getLocale, getTranslations } from "next-intl/server";
import { connection } from "next/server";
import "./globals.css";

// next/font downloads these at build time and serves them from the app itself,
// so the running hub never contacts Google.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Metadata");
  // Pages set their own title (src/app/page-title.ts); this adds the app's name.
  return { title: { template: `%s · ${t("title")}`, default: t("title") } };
}

// Every page is rendered per request, never served from a build-time copy: the
// Content-Security-Policy nonce (src/proxy.ts) is new on each request and Next
// can only stamp it onto scripts it renders now. A prerendered page's scripts
// carry no nonce and the browser would refuse to run them. On a hub serving a
// handful of devices the cost is negligible.
export const instant = false;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>
          {children}
          <Toaster richColors position="top-center" />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
