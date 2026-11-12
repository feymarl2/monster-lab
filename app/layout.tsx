import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { DISCLAIMER } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Monster Lab — contract autopsy",
  description:
    "Paste a token contract address. Five data sources get stitched into one verdict: IT'S ALIVE or DEAD ON ARRIVAL.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        {children}
        <footer className="px-4 py-6 text-center text-xs text-zinc-500">{DISCLAIMER}</footer>
      </body>
    </html>
  );
}
