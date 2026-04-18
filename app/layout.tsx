import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "InsightGraph",
  description: "Hybrid RAG dashboard combining Supabase vectors and Neo4j graph retrieval.",
  icons: {
    icon: [
      { url: "/icon.jpeg", type: "image/jpeg" },
      { url: "/insightgraph-logo.jpeg", type: "image/jpeg" }
    ],
    shortcut: "/icon.jpeg",
    apple: "/icon.jpeg"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
