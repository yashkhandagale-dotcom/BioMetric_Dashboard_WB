import type { Metadata } from "next";
import "./globals.css";
import ThemeProvider from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "Attendance Dashboard — WonderBiz",
  description: "Employee Attendance Dashboard POC",
};

// This is the ROOT layout — it wraps every route, including everything
// under /leave, since Next.js nests app/leave/**/layout.tsx inside this
// one. So one ThemeProvider here covers both apps; the leave tracker's
// own layouts don't need a second provider.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }} suppressHydrationWarning>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}