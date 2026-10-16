"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SpentLogo({ className, alt = "Spent" }: { className?: string; alt?: string }) {
  return (
    <>
      <img src="/logo_lightmode.svg" alt={alt} className={cn("w-auto dark:hidden", className)} />
      <img
        src="/logo_darkmode.svg"
        alt={alt}
        className={cn("hidden w-auto dark:block", className)}
      />
    </>
  );
}

/** Logo and wordmark for full-screen phone pages (onboarding, prompts). */
export function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <SpentLogo className="h-8" alt="" />
      <span className="font-serif text-xl font-semibold leading-none tracking-tight">Spent</span>
    </div>
  );
}

interface MobileScreenProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Sits between the brand mark and the title (a step indicator). */
  top?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}

/** A full-height phone page: brand at the top, a heading, then one card of content. */
export function MobileScreen({ eyebrow, title, description, top, children, footer }: MobileScreenProps) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background px-5 pb-8 pt-6">
      <header className="flex items-center justify-between gap-4">
        <BrandMark />
        {top}
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col pt-10">
        {eyebrow ? (
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground rtl:tracking-normal">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="mt-2 font-serif text-[30px] leading-[1.1] tracking-tight text-balance">
          {title}
        </h1>
        {description ? (
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
        {children ? <div className="mt-7">{children}</div> : null}
      </main>
      {footer ? (
        <footer className="mx-auto mt-6 w-full max-w-md text-center text-xs text-muted-foreground">
          {footer}
        </footer>
      ) : null}
    </div>
  );
}

/** The card that holds a step's controls. */
export function ScreenCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-border bg-card p-4 shadow-sm", className)}>
      {children}
    </div>
  );
}
