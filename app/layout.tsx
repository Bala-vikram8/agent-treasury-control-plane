import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Treasury Control Plane",
  description:
    "A policy controlled workflow for machine initiated Stripe sandbox payments.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
