"use client";

import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTrip, updateTrip } from "@/lib/api";
import { countryForCurrency, normalizeCurrency } from "@/lib/currency";
import { parseTripInput, type TripInputError } from "@/lib/trips/validation";
import type { Trip, TripInput } from "@/lib/trips/types";
import { useInvalidateTrips } from "./use-trip-actions";

interface TripFormDialogProps {
  /** Edit mode when set. */
  trip?: Trip;
  /** Prefill for a new trip. */
  initial?: TripInput;
  onClose: () => void;
  onSaved: (trip: Trip) => void;
}

export function TripFormDialog({ trip, initial, onClose, onSaved }: TripFormDialogProps) {
  const t = useTranslations("trips");
  const locale = useLocale();
  const invalidateTrips = useInvalidateTrips();
  const seed = trip ?? initial;
  const [name, setName] = useState(seed?.name ?? "");
  const [country, setCountry] = useState(seed?.country ?? "");
  const [currency, setCurrency] = useState(seed?.currency ?? "");
  const [startDate, setStartDate] = useState(seed?.startDate ?? "");
  const [endDate, setEndDate] = useState(seed?.endDate ?? "");
  const [error, setError] = useState<TripInputError | null>(null);

  const mutation = useMutation({
    mutationFn: (input: TripInput) =>
      trip ? updateTrip(trip.id, input) : createTrip(input),
    onSuccess: (saved) => {
      invalidateTrips();
      toast.success(t("savedToast"));
      onSaved(saved);
    },
    onError: () => toast.error(t("errorToast")),
  });

  const handleCurrencyBlur = () => {
    if (currency.trim() === "") return;
    const code = normalizeCurrency(currency);
    setCurrency(code);
    if (country.trim() === "") setCountry(countryForCurrency(code, locale));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseTripInput({ name, country, currency, startDate, endDate });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    mutation.mutate(parsed.value.input);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl tracking-tight">
              {trip ? t("form.titleEdit") : t("form.titleNew")}
            </DialogTitle>
            <DialogDescription>{t("form.currencyHint")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="trip-name">{t("form.name")}</Label>
            <Input
              id="trip-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("form.namePlaceholder")}
              maxLength={80}
            />
          </div>

          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="trip-country">{t("form.country")}</Label>
              <Input
                id="trip-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder={t("form.countryPlaceholder")}
                maxLength={60}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="trip-currency">{t("form.currency")}</Label>
              <Input
                id="trip-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                onBlur={handleCurrencyBlur}
                placeholder="EUR"
                maxLength={4}
                dir="ltr"
                className="uppercase"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="trip-start">{t("form.startDate")}</Label>
              <Input
                id="trip-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="trip-end">{t("form.endDate")}</Label>
              <Input
                id="trip-end"
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {t(`form.errors.${error}`)}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("form.cancel")}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t("form.saving") : t("form.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
