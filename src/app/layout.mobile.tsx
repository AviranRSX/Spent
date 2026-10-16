import type { Metadata } from "next";
import { Inter, Fraunces, Geist_Mono } from "next/font/google";
import { I18nProvider } from "@/i18n/client-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/components/query-provider";
import { dirFor, defaultLocale, type Locale } from "@/i18n/routing";
import en from "@/i18n/messages/en.json";
import he from "@/i18n/messages/he.json";
import "./globals.css";

// Phone build root layout. Same providers as layout.tsx, but a static export
// has no request cookie, so the locale is chosen on the device (Task 14).
// Until then it renders the default locale from the bundled messages.

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

const MESSAGES: Record<Locale, Record<string, unknown>> = { en, he };

export const metadata: Metadata = {
  title: "Spent",
  description: "Personal finance tracker with AI-powered categorization",
};

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
      <body className="min-h-full flex flex-col">
        <I18nProvider locale={locale} messages={MESSAGES[locale]} timeZone="Asia/Jerusalem">
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <QueryProvider>
              <TooltipProvider>
                {children}
                <Toaster />
              </TooltipProvider>
            </QueryProvider>
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
