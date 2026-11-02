import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Film Yearbook",
  description: "Turn your Letterboxd diary into a print-ready annual poster.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
