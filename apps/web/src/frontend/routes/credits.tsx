import { createRoute } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { ArrowDownToLine, Coins, CreditCard, PlusCircle } from "lucide-react";
import type { CreditAccount } from "@moltbooky/core/domain/types";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { api } from "../lib/api";
import { credits } from "../lib/format";
import { isTestingModeEnabled, testingModeChangeEvent } from "../lib/testingMode";
import { rootRoute } from "./root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "credits",
  component: CreditsPage
});

function CreditsPage() {
  const [creditAccount, setCreditAccount] = useState<CreditAccount | null>(null);
  const [ledger, setLedger] = useState<Array<{ id: string; type: string; amountCents: number; description: string; createdAt: string }>>([]);
  const [purchaseCredits, setPurchaseCredits] = useState("25");
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [error, setError] = useState("");
  const [ledgerError, setLedgerError] = useState("");
  const [testingMode, setTestingMode] = useState(isTestingModeEnabled());
  const [creditPurchasesEnabled, setCreditPurchasesEnabled] = useState(testingMode);
  const [notice, setNotice] = useState("");

  async function refreshCredits() {
    setError("");
    setLedgerError("");
    const [creditResult, ledgerResult] = await Promise.allSettled([api.credits(), api.ledger()]);

    if (creditResult.status === "fulfilled") {
      setCreditAccount(creditResult.value.creditAccount);
    } else {
      setError(creditResult.reason instanceof Error ? creditResult.reason.message : "Credits could not be loaded.");
    }

    if (ledgerResult.status === "fulfilled") {
      const ledgerData = ledgerResult.value;
      setLedger(ledgerData.ledger);
    } else {
      setLedgerError(ledgerResult.reason instanceof Error ? ledgerResult.reason.message : "Ledger could not be loaded.");
    }
  }

  useEffect(() => {
    void refreshCredits();
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function refreshPaymentsConfig() {
      const config = await api.paymentsConfig();
      if (isMounted) {
        setCreditPurchasesEnabled(config.creditPurchasesEnabled);
      }
    }

    void refreshPaymentsConfig();
    return () => {
      isMounted = false;
    };
  }, [testingMode]);

  useEffect(() => {
    function refreshTestingMode() {
      setTestingMode(isTestingModeEnabled());
      void refreshCredits();
    }

    window.addEventListener(testingModeChangeEvent, refreshTestingMode);
    window.addEventListener("storage", refreshTestingMode);
    return () => {
      window.removeEventListener(testingModeChangeEvent, refreshTestingMode);
      window.removeEventListener("storage", refreshTestingMode);
    };
  }, []);

  async function createCreditPurchase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const amount = Number(purchaseCredits);
    const amountCents = Math.round(amount * 100);
    if (!Number.isFinite(amount) || amountCents < 500 || amountCents > 10_000) {
      setError("Credit purchase amount must be between 5 and 100 credits.");
      return;
    }
    if (!testingMode && !creditPurchasesEnabled) {
      setError("Credit purchases are temporarily unavailable while Stripe configuration is checked.");
      return;
    }

    setIsPurchasing(true);
    try {
      const purchase = await api.createCreditPurchase(amountCents);
      if (testingMode) {
        await refreshCredits();
        setNotice(`Added ${credits(amountCents)} for local testing.`);
        setIsPurchasing(false);
        return;
      }
      window.location.href = purchase.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start Stripe Checkout.");
      setIsPurchasing(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header className="flex items-start justify-between gap-4 [&_h1]:max-w-[850px] [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:tracking-tight max-[720px]:[&_h1]:text-2xl [&_p]:text-sm [&_p]:leading-6 [&_p]:text-muted-foreground">
        <div>
          <h1>Credits</h1>
          <p>{testingMode ? "Local testing credits." : "Platform credit balances and ledger activity."}</p>
        </div>
      </header>
      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}
      {notice && <div className="rounded-lg border bg-card p-4 text-sm text-card-foreground">{notice}</div>}
      <section className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1 [&>div]:rounded-lg [&>div]:border [&>div]:bg-card [&>div]:p-4 [&>div]:text-card-foreground [&_span]:block [&_span]:text-sm [&_span]:leading-6 [&_span]:text-muted-foreground [&_strong]:mt-1 [&_strong]:block [&_strong]:text-2xl [&_strong]:font-semibold [&_strong]:tracking-tight [&_strong]:text-foreground">
        <div>
          <span>Available</span>
          <strong>{credits(creditAccount?.availableCents ?? 0)}</strong>
        </div>
        <div>
          <span>Locked</span>
          <strong>{credits(creditAccount?.lockedCents ?? 0)}</strong>
        </div>
      </section>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <CardTitle>{testingMode ? "Add testing credits" : "Buy credits"}</CardTitle>
            <Coins size={20} />
          </div>
        </CardHeader>
        <CardContent>
          {!testingMode && !creditPurchasesEnabled && (
            <div className="rounded-lg border bg-card p-4 text-sm text-card-foreground">
              Credit purchases are temporarily unavailable while Stripe configuration is checked.
            </div>
          )}
          <form className="grid gap-4 [&_label]:mb-2 [&_label]:block [&_label]:text-sm [&_label]:font-semibold" onSubmit={createCreditPurchase}>
            <div>
              <label htmlFor="credit-purchase-amount">Credits</label>
              <div className="relative [&_span]:pointer-events-none [&_span]:absolute [&_span]:left-3 [&_span]:top-1/2 [&_span]:-translate-y-1/2 [&_span]:text-sm [&_span]:font-semibold [&_span]:text-muted-foreground [&_input]:pl-7">
                <Input
                  id="credit-purchase-amount"
                  inputMode="decimal"
                  min="5"
                  max="100"
                  step="1"
                  type="number"
                  value={purchaseCredits}
                  onChange={(event) => setPurchaseCredits(event.target.value)}
                />
              </div>
              <p className="text-xs font-medium text-muted-foreground">
                {testingMode ? "Add local testing credits from 5 to 100." : "Stripe Checkout sells credit bundles from 5 to 100 credits."}
              </p>
            </div>
            <div className="grid grid-cols-4 gap-2 max-[560px]:grid-cols-2 [&_button]:px-2">
              {[10, 25, 50, 100].map((amount) => (
                <Button key={amount} type="button" variant="outline" onClick={() => setPurchaseCredits(String(amount))}>
                  {credits(amount * 100)}
                </Button>
              ))}
            </div>
            <Button type="submit" disabled={isPurchasing || (!testingMode && !creditPurchasesEnabled)}>
              {testingMode ? <PlusCircle size={18} /> : <CreditCard size={18} />}
              {isPurchasing
                ? testingMode
                  ? "Adding..."
                  : "Opening Checkout"
                : testingMode
                  ? "Add credits"
                  : creditPurchasesEnabled
                    ? "Buy with Stripe"
                    : "Credit purchases unavailable"}
            </Button>
          </form>
        </CardContent>
      </Card>
      <section className="rounded-lg border bg-card p-5 text-card-foreground [&_h2]:inline-flex [&_h2]:items-center [&_h2]:gap-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight">
        <div className="flex items-start justify-between gap-4">
          <h2>Ledger</h2>
          <ArrowDownToLine size={20} />
        </div>
        <div className="grid gap-3 [&>div]:flex [&>div]:items-center [&>div]:justify-between [&>div]:gap-4 [&>div]:border-b [&>div]:border-border [&>div]:py-3 last:[&>div]:border-b-0 max-[560px]:[&>div]:grid [&_span]:text-sm [&_span]:font-medium [&_span]:text-muted-foreground [&_strong]:text-sm [&_strong]:font-medium">
          {ledgerError && <p className="mt-4 inline-flex items-center gap-2 text-sm leading-6 text-muted-foreground">Ledger could not be loaded. Your credit balance is still shown above.</p>}
          {ledger.map((entry) => (
            <div key={entry.id}>
              <span>{entry.description}</span>
              <strong>{entry.type} · {credits(entry.amountCents)}</strong>
            </div>
          ))}
          {ledger.length === 0 && <p className="mt-4 inline-flex items-center gap-2 text-sm leading-6 text-muted-foreground">No ledger entries yet.</p>}
        </div>
      </section>
    </div>
  );
}
