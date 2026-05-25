import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { WalletCards } from "lucide-react";
import type { WalletAccount } from "../../domain/types";
import { api } from "../lib/api";
import { money } from "../lib/format";

export const Route = createFileRoute("/wallet")({
  component: WalletPage
});

function WalletPage() {
  const [wallet, setWallet] = useState<WalletAccount | null>(null);
  const [ledger, setLedger] = useState<Array<{ id: string; type: string; amountCents: number; description: string; createdAt: string }>>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.wallet(), api.ledger()])
      .then(([walletData, ledgerData]) => {
        setWallet(walletData.wallet);
        setLedger(ledgerData.ledger);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

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
      <section className="panel">
        <div className="section-title">
          <h2>Deposits</h2>
          <WalletCards size={20} />
        </div>
        <p className="fine-print">Live Stripe deposits are intentionally disabled until legal and payment approval are complete.</p>
      </section>
      <section className="panel">
        <h2>Ledger</h2>
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
