import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://fairturn.ahmardchain.chatgpt.site"),
  title: "FairTurn — Community operations that remember",
  description:
    "A privacy-first AI teammate for creator communities: triage the noise, respect moderator boundaries, and close every follow-up.",
  openGraph: {
    title: "FairTurn — Every community gets a fair turn",
    description:
      "Community moderation and creator opportunity triage, with human approval where it matters.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "FairTurn — Every community gets a fair turn",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "FairTurn — Every community gets a fair turn",
    description:
      "Community moderation and creator opportunity triage, with human approval where it matters.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <Script
          src="https://telegram.org/js/telegram-web-app.js?63"
          strategy="beforeInteractive"
        />
      </head>
      <body className={manrope.variable}>{children}</body>
    </html>
  );
}
