import { createRoute } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { ArrowDownToLine, Coins, CreditCard } from "lucide-react";
import type { WalletAccount } from "@moltbooky/core/domain/types";
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
  component: WalletPage
});

export const WalletAliasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "wallet",
  component: WalletPage
});

function WalletPage() {
  const [wallet, setWallet] = useState<WalletAccount | null>(null);
  const [ledger, setLedger] = useState<Array<{ id: string; type: string; amountCents: number; description: string; createdAt: string }>>([]);
  const [purchaseCredits, setPurchaseCredits] = useState("25");
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [error, setError] = useState("");
  const [ledgerError, setLedgerError] = useState("");
  const [testingMode, setTestingMode] = useState(isTestingModeEnabled());

  async function refreshWallet() {
    setError("");
    setLedgerError("");
    const [walletResult, ledgerResult] = await Promise.allSettled([api.wallet(), api.ledger()]);

    if (walletResult.status === "fulfilled") {
      const walletData = walletResult.value;
      setWallet(walletData.wallet);
    } else {
      setError(walletResult.reason instanceof Error ? walletResult.reason.message : "Credits could not be loaded.");
    }

    if (ledgerResult.status === "fulfilled") {
      const ledgerData = ledgerResult.value;
      setLedger(ledgerData.ledger);
    } else {
      setLedgerError(ledgerResult.reason instanceof Error ? ledgerResult.reason.message : "Ledger could not be loaded.");
    }
  }

  useEffect(() => {
    void refreshWallet();
  }, []);

  useEffect(() => {
    function refreshTestingMode() {
      setTestingMode(isTestingModeEnabled());
      void refreshWallet();
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

    setIsPurchasing(true);
    try {
      const deposit = await api.createCreditPurchase(amountCents);
      if (testingMode) {
        await refreshWallet();
        setIsPurchasing(false);
        return;
      }
      window.location.href = deposit.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start Stripe Checkout.");
      setIsPurchasing(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Credits</h1>
          <p>{testingMode ? "Local testing credits." : "Buy platform credits before creating or matching a bet."}</p>
        </div>
      </header>
      {error && <div className="notice error">{error}</div>}
      <section className="stats-grid wallet-stats">
        <div>
          <span>Available</span>
          <strong>{credits(wallet?.availableCents ?? 0)}</strong>
        </div>
        <div>
          <span>Locked</span>
          <strong>{credits(wallet?.lockedCents ?? 0)}</strong>
        </div>
        <div>
          <span>Pending cashout</span>
          <strong>{credits(wallet?.pendingWithdrawalCents ?? 0)}</strong>
        </div>
      </section>
      <Card>
        <CardHeader>
          <div className="section-title">
            <CardTitle>Buy credits</CardTitle>
            <Coins size={20} />
          </div>
        </CardHeader>
        <CardContent>
          <form className="deposit-form" onSubmit={createCreditPurchase}>
            <div>
              <label htmlFor="credit-purchase-amount">Credits</label>
              <div className="deposit-input">
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
              <p className="field-help">
                {testingMode ? "Add local testing credits from 5 to 100." : "Stripe Checkout sells credit bundles from 5 to 100 credits."}
              </p>
            </div>
            <div className="deposit-presets">
              {[10, 25, 50, 100].map((amount) => (
                <Button key={amount} type="button" variant="outline" onClick={() => setPurchaseCredits(String(amount))}>
                  {credits(amount * 100)}
                </Button>
              ))}
            </div>
            <Button type="submit" disabled={isPurchasing}>
              <CreditCard size={18} />
              {isPurchasing ? (testingMode ? "Adding..." : "Opening Checkout") : testingMode ? "Add credits" : "Buy with Stripe"}
            </Button>
          </form>
        </CardContent>
      </Card>
      <section className="panel">
        <div className="section-title">
          <h2>Ledger</h2>
          <ArrowDownToLine size={20} />
        </div>
        <div className="ledger-list">
          {ledgerError && <p className="fine-print">Ledger could not be loaded. Your credit balance is still shown above.</p>}
          {ledger.map((entry) => (
            <div key={entry.id}>
              <span>{entry.description}</span>
              <strong>{entry.type} · {credits(entry.amountCents)}</strong>
            </div>
          ))}
          {ledger.length === 0 && <p className="fine-print">No ledger entries yet.</p>}
        </div>
      </section>
    </div>
  );
}
