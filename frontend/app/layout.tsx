import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Market Digital Twin | Institutional Decision Intelligence Sandbox",
  description:
    "Multi-agent market and supply-chain simulator powered by NVIDIA Nemotron on Nebius Token Factory, grounded in live news via Tavily.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#07090e] text-slate-100 antialiased selection:bg-cyan-500/30 selection:text-cyan-200">
        {children}
      </body>
    </html>
  );
}

