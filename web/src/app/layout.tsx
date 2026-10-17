import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-manrope",
});

export const metadata: Metadata = {
  title: "RUNVA — Prove it before you ship",
  description:
    "The AI reliability engineer that breaks your integration, repairs it, and proves the repair in a real sandbox.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`antialiased dark ${GeistSans.variable} ${GeistMono.variable} ${manrope.variable}`}
    >
      <body className="min-h-screen selection:bg-red-500/20 selection:text-red-200">
        {children}
      </body>
    </html>
  );
}
