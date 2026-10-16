import type { Metadata, Viewport } from "next";
import { Inter, Fraunces, Geist_Mono } from "next/font/google";
import { dirFor, defaultLocale, type Locale } from "@/i18n/routing";
import { MobileRoot } from "@/mobile/boot/mobile-root";
import "./globals.css";

// Phone build root layout. A static export has no request cookie, so the
// locale is chosen on the device: MobileRoot holds the providers, switches
// to the PC's language from the snapshot, and updates <html lang dir>.

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-serif",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Spent",
  description: "Personal finance tracker with AI-powered categorization",
};

// viewport-fit=cover lets the WebView draw under the status and navigation
// bars; the shell then pads itself back in with env(safe-area-inset-*).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Safe-area padding for the page, plus the portaled sheets (sidebar and
// detail sheets) and the sticky page header, which sit outside that padding.
const SAFE_AREA_SHELL = [
  "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
  "pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]",
  "[&_[data-slot=sheet-content]]:pt-[env(safe-area-inset-top)]",
  "[&_[data-slot=sheet-content]]:pb-[env(safe-area-inset-bottom)]",
  "[&_[data-mobile=true]]:pt-[env(safe-area-inset-top)]",
  "[&_[data-mobile=true]]:pb-[env(safe-area-inset-bottom)]",
  "[&_header.sticky]:top-[env(safe-area-inset-top)]",
].join(" ");

// Phone tap targets: the shared primitives are sized for a mouse, so raise
// every control to at least 44 px here instead of restyling the desktop.
const TAP_TARGETS = [
  "[&_[data-slot=button]]:min-h-11! [&_[data-slot=button]]:min-w-11!",
  "[&_[data-slot=sidebar-trigger]]:size-11!",
  "[&_[data-sidebar=menu-button]]:min-h-11!",
  "[&_[data-slot=tabs-list]]:h-auto! [&_[data-slot=tabs-trigger]]:min-h-11!",
  "[&_[data-slot=dropdown-menu-trigger]]:min-h-11! [&_[data-slot=dropdown-menu-trigger]]:items-center!",
  "[&_[data-slot=dropdown-menu-item]]:min-h-11!",
  "[&_[data-slot=select-trigger]]:min-h-11! [&_[data-slot=popover-trigger]]:min-h-11!",
  "[&_[data-slot=input]]:min-h-11!",
  "[&_th_button]:min-h-11! [&_[data-slot=sheet-close]]:size-11!",
  "[&_[data-sidebar=header]>a]:min-h-11!",
].join(" ");

export default function MobileRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale: Locale = defaultLocale;
  return (
    <html
      lang={locale}
      dir={dirFor(locale)}
      className={`${inter.variable} ${fraunces.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className={`min-h-full flex flex-col ${SAFE_AREA_SHELL} ${TAP_TARGETS}`}>
        {/* Covers the status bar strip so content scrolling under it stays hidden. */}
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-0 z-20 h-[env(safe-area-inset-top)] bg-background"
        />
        <MobileRoot>{children}</MobileRoot>
      </body>
    </html>
  );
}
