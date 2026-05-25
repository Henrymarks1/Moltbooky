import { createRoute } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { ArrowDownToLine, CreditCard, WalletCards } from "lucide-react";
import type { WalletAccount } from "@moltbooky/core/domain/types";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { api } from "../lib/api";
import { money } from "../lib/format";
import { rootRoute } from "./root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "wallet",
  component: WalletPage
});

function WalletPage() {
  const [wallet, setWallet] = useState<WalletAccount | null>(null);
  const [ledger, setLedger] = useState<Array<{ id: string; type: string; amountCents: number; description: string; createdAt: string }>>([]);
  const [depositDollars, setDepositDollars] = useState("25");
  const [isDepositing, setIsDepositing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.wallet(), api.ledger()])
      .then(([walletData, ledgerData]) => {
        setWallet(walletData.wallet);
        setLedger(ledgerData.ledger);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function createDeposit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const amount = Number(depositDollars);
    const amountCents = Math.round(amount * 100);
    if (!Number.isFinite(amount) || amountCents < 500 || amountCents > 10_000) {
      setError("Deposit amount must be between $5 and $100.");
      return;
    }

    setIsDepositing(true);
    try {
      const deposit = await api.createDeposit(amountCents);
      window.location.href = deposit.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start Stripe Checkout.");
      setIsDepositing(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Wallet</h1>
          <p>Internal ledger balances for private beta settlement.</p>
        </div>
      </header>
      {error && <div className="notice error">{error}</div>}
      <section className="stats-grid wallet-stats">
        <div>
          <span>Available</span>
          <strong>{money(wallet?.availableCents ?? 0)}</strong>
        </div>
        <div>
          <span>Locked</span>
          <strong>{money(wallet?.lockedCents ?? 0)}</strong>
        </div>
        <div>
          <span>Pending withdrawal</span>
          <strong>{money(wallet?.pendingWithdrawalCents ?? 0)}</strong>
        </div>
      </section>
      <Card>
        <CardHeader>
          <div className="section-title">
            <CardTitle>Deposits</CardTitle>
            <WalletCards size={20} />
          </div>
        </CardHeader>
        <CardContent>
          <form className="deposit-form" onSubmit={createDeposit}>
            <div>
              <label htmlFor="deposit-amount">Amount</label>
              <div className="deposit-input">
                <span>$</span>
                <Input
                  id="deposit-amount"
                  inputMode="decimal"
                  min="5"
                  max="100"
                  step="1"
                  type="number"
                  value={depositDollars}
                  onChange={(event) => setDepositDollars(event.target.value)}
                />
              </div>
              <p className="field-help">Stripe Checkout accepts deposits from $5 to $100.</p>
            </div>
            <div className="deposit-presets">
              {[10, 25, 50, 100].map((amount) => (
                <Button key={amount} type="button" variant="outline" onClick={() => setDepositDollars(String(amount))}>
                  {money(amount * 100)}
                </Button>
              ))}
            </div>
            <Button type="submit" disabled={isDepositing}>
              <CreditCard size={18} />
              {isDepositing ? "Opening Checkout" : "Deposit with Stripe"}
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
          {ledger.map((entry) => (
            <div key={entry.id}>
              <span>{entry.description}</span>
              <strong>{entry.type} · {money(entry.amountCents)}</strong>
            </div>
          ))}
          {ledger.length === 0 && <p className="fine-print">No ledger entries yet.</p>}
        </div>
      </section>
    </div>
  );
}
