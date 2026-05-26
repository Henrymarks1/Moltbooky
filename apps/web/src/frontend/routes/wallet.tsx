import { createRoute } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { ArrowDownToLine, Banknote, Coins, CreditCard } from "lucide-react";
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
  const [cashoutCredits, setCashoutCredits] = useState("25");
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isCashingOut, setIsCashingOut] = useState(false);
  const [error, setError] = useState("");
  const [ledgerError, setLedgerError] = useState("");
  const [testingMode, setTestingMode] = useState(isTestingModeEnabled());
  const [creditPurchasesEnabled, setCreditPurchasesEnabled] = useState(testingMode);
  const [cashoutsEnabled, setCashoutsEnabled] = useState(testingMode);
  const [payoutsEnabled, setPayoutsEnabled] = useState(testingMode);
  const [isSettingUpPayouts, setIsSettingUpPayouts] = useState(false);

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
    let isMounted = true;

    async function refreshPaymentsConfig() {
      if (testingMode) {
        setCreditPurchasesEnabled(true);
        setCashoutsEnabled(true);
        setPayoutsEnabled(true);
        return;
      }

      const config = await api.paymentsConfig();
      if (isMounted) {
        setCreditPurchasesEnabled(config.creditPurchasesEnabled);
        setCashoutsEnabled(config.cashoutsEnabled);
      }

      try {
        const status = await api.payoutStatus();
        if (isMounted) {
          setCashoutsEnabled(status.cashoutsEnabled);
          setPayoutsEnabled(status.payoutsEnabled);
        }
      } catch {
        if (isMounted) {
          setPayoutsEnabled(false);
        }
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
    if (!testingMode && !creditPurchasesEnabled) {
      setError("Credit purchases are temporarily unavailable while Stripe configuration is checked.");
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

  async function createWithdrawal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const amount = Number(cashoutCredits);
    const amountCents = Math.round(amount * 100);
    if (!Number.isFinite(amount) || amountCents <= 0) {
      setError("Cashout amount must be greater than 0 credits.");
      return;
    }
    if (wallet && amountCents > wallet.availableCents) {
      setError("Cashout amount cannot exceed your available credits.");
      return;
    }
    if (!testingMode && !cashoutsEnabled) {
      setError("Cashouts are temporarily unavailable while bank account payouts are being checked.");
      return;
    }
    if (!testingMode && !payoutsEnabled) {
      setError("Connect a bank account before cashing out.");
      return;
    }

    setIsCashingOut(true);
    try {
      await api.createWithdrawal(amountCents);
      await refreshWallet();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to request cashout.");
    } finally {
      setIsCashingOut(false);
    }
  }

  async function setupPayouts() {
    setError("");
    setIsSettingUpPayouts(true);
    try {
      const link = await api.createPayoutOnboardingLink();
      window.location.href = link.onboardingUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start bank account setup.");
      setIsSettingUpPayouts(false);
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
          {!testingMode && !creditPurchasesEnabled && (
            <div className="notice">
              Credit purchases are temporarily unavailable while Stripe configuration is checked.
            </div>
          )}
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
            <Button type="submit" disabled={isPurchasing || (!testingMode && !creditPurchasesEnabled)}>
              <CreditCard size={18} />
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
      <Card>
        <CardHeader>
          <div className="section-title">
            <CardTitle>Cash out</CardTitle>
            <Banknote size={20} />
          </div>
        </CardHeader>
        <CardContent>
          {!testingMode && !cashoutsEnabled && (
            <div className="notice">
              Cashouts are temporarily unavailable while bank account payouts are being checked.
            </div>
          )}
          {!testingMode && cashoutsEnabled && !payoutsEnabled && (
            <div className="notice">
              <p>Connect a bank account before requesting a cashout.</p>
              <Button type="button" variant="outline" onClick={setupPayouts} disabled={isSettingUpPayouts}>
                <Banknote size={18} />
                {isSettingUpPayouts ? "Opening secure setup..." : "Connect bank account"}
              </Button>
            </div>
          )}
          <form className="deposit-form" onSubmit={createWithdrawal}>
            <div>
              <label htmlFor="cashout-amount">Credits</label>
              <div className="deposit-input">
                <Input
                  id="cashout-amount"
                  inputMode="decimal"
                  min="0.01"
                  max={String((wallet?.availableCents ?? 0) / 100)}
                  step="0.01"
                  type="number"
                  value={cashoutCredits}
                  onChange={(event) => setCashoutCredits(event.target.value)}
                />
              </div>
              <p className="field-help">
                Cashouts send the dollar equivalent to your connected bank account.
              </p>
            </div>
            <div className="deposit-presets">
              {[10, 25, 50, 100].map((amount) => (
                <Button
                  key={amount}
                  type="button"
                  variant="outline"
                  disabled={(wallet?.availableCents ?? 0) < amount * 100}
                  onClick={() => setCashoutCredits(String(amount))}
                >
                  {credits(amount * 100)}
                </Button>
              ))}
            </div>
            <Button type="submit" disabled={isCashingOut || (wallet?.availableCents ?? 0) <= 0 || (!testingMode && (!cashoutsEnabled || !payoutsEnabled))}>
              <Banknote size={18} />
              {isCashingOut ? "Requesting..." : "Request cashout"}
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
