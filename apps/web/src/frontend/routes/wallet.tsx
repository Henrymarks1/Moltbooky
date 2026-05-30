import { useCreateWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { createRoute } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { ArrowDownToLine, Banknote, Coins, Copy, CreditCard, RefreshCw, Wallet } from "lucide-react";
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
  const [paymentProfile, setPaymentProfile] = useState<{ depositAddress: string; withdrawalAddress: string | null } | null>(null);
  const [isSyncingDeposits, setIsSyncingDeposits] = useState(false);
  const [notice, setNotice] = useState("");

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
          setPaymentProfile((profile) => (profile ? { ...profile, withdrawalAddress: status.withdrawalAddress } : profile));
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
      setError("USDC deposits are temporarily unavailable while Coinbase Onramp is checked.");
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
      setPaymentProfile((profile) => ({ depositAddress: deposit.depositAddress, withdrawalAddress: profile?.withdrawalAddress ?? null }));
      window.location.href = deposit.onrampUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start Coinbase Onramp.");
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
      setError("USDC cashouts are temporarily unavailable while Coinbase CDP is checked.");
      return;
    }
    if (!testingMode && !payoutsEnabled) {
      setError("Set up a USDC wallet before cashing out.");
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

  async function syncDeposits() {
    setError("");
    setNotice("");
    setIsSyncingDeposits(true);
    try {
      const result = await api.syncDeposits();
      await refreshWallet();
      setNotice(result.creditedCents > 0 ? `Credited ${credits(result.creditedCents)} from Base USDC deposits.` : "No new confirmed USDC deposits found.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to refresh USDC deposits.");
    } finally {
      setIsSyncingDeposits(false);
    }
  }

  async function copyDepositAddress() {
    if (!paymentProfile?.depositAddress) {
      return;
    }
    await navigator.clipboard.writeText(paymentProfile.depositAddress);
    setNotice("Deposit address copied.");
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header className="flex items-start justify-between gap-4 [&_h1]:max-w-[850px] [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:tracking-tight max-[720px]:[&_h1]:text-2xl [&_p]:text-sm [&_p]:leading-6 [&_p]:text-muted-foreground">
        <div>
          <h1>Credits</h1>
          <p>{testingMode ? "Local testing credits." : "Buy platform credits before creating or matching a bet."}</p>
        </div>
      </header>
      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}
      {notice && <div className="rounded-lg border bg-card p-4 text-sm text-card-foreground">{notice}</div>}
      <section className="grid grid-cols-3 gap-3 max-[720px]:grid-cols-1 [&>div]:rounded-lg [&>div]:border [&>div]:bg-card [&>div]:p-4 [&>div]:text-card-foreground [&_span]:block [&_span]:text-sm [&_span]:leading-6 [&_span]:text-muted-foreground [&_strong]:mt-1 [&_strong]:block [&_strong]:text-2xl [&_strong]:font-semibold [&_strong]:tracking-tight [&_strong]:text-foreground">
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
          <div className="flex items-start justify-between gap-4">
            <CardTitle>Add USDC</CardTitle>
            <Coins size={20} />
          </div>
        </CardHeader>
        <CardContent>
          {!testingMode && !creditPurchasesEnabled && (
            <div className="rounded-lg border bg-card p-4 text-sm text-card-foreground">
              USDC deposits are temporarily unavailable while Coinbase Onramp is checked.
            </div>
          )}
          {!testingMode && import.meta.env.VITE_PRIVY_APP_ID && (
            <PrivyWalletSetup
              disabled={!cashoutsEnabled}
              onReady={(profile) => {
                setPaymentProfile(profile);
                setPayoutsEnabled(Boolean(profile.withdrawalAddress));
              }}
              onError={setError}
            />
          )}
          {!testingMode && !import.meta.env.VITE_PRIVY_APP_ID && (
            <div className="rounded-lg border bg-card p-4 text-sm text-card-foreground">Privy is not configured. Set VITE_PRIVY_APP_ID before linking a withdrawal wallet.</div>
          )}
          {!testingMode && paymentProfile?.depositAddress && (
            <div className="grid gap-3 rounded-lg border bg-card p-4 text-sm text-card-foreground [&>span]:text-xs [&>span]:font-semibold [&>span]:uppercase [&>span]:text-muted-foreground [&_code]:mt-2 [&_code]:block [&_code]:overflow-auto [&_code]:break-all [&_code]:rounded-md [&_code]:bg-muted [&_code]:p-3 [&_code]:text-sm [&_code]:text-foreground">
              <span>Base USDC deposit address</span>
              <code>{paymentProfile.depositAddress}</code>
              <div className="grid grid-cols-4 gap-2 max-[560px]:grid-cols-2 [&_button]:px-2">
                <Button type="button" variant="outline" onClick={copyDepositAddress}>
                  <Copy size={18} /> Copy
                </Button>
                <Button type="button" variant="outline" onClick={syncDeposits} disabled={isSyncingDeposits}>
                  <RefreshCw size={18} /> {isSyncingDeposits ? "Refreshing..." : "Refresh deposits"}
                </Button>
              </div>
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
                {testingMode ? "Add local testing credits from 5 to 100." : "Buy Base USDC through Coinbase Onramp. 1 USDC equals 1 credit."}
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
              <CreditCard size={18} />
              {isPurchasing
                ? testingMode
                  ? "Adding..."
                  : "Opening Onramp"
                : testingMode
                  ? "Add credits"
                  : creditPurchasesEnabled
                    ? "Buy USDC"
                    : "Credit purchases unavailable"}
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <CardTitle>Cash out</CardTitle>
            <Banknote size={20} />
          </div>
        </CardHeader>
        <CardContent>
          {!testingMode && !cashoutsEnabled && (
            <div className="rounded-lg border bg-card p-4 text-sm text-card-foreground">
              USDC cashouts are temporarily unavailable while Coinbase CDP is checked.
            </div>
          )}
          {!testingMode && cashoutsEnabled && !payoutsEnabled && (
            <div className="rounded-lg border bg-card p-4 text-sm text-card-foreground">
              <p>Set up a USDC withdrawal wallet before requesting a cashout.</p>
            </div>
          )}
          <form className="grid gap-4 [&_label]:mb-2 [&_label]:block [&_label]:text-sm [&_label]:font-semibold" onSubmit={createWithdrawal}>
            <div>
              <label htmlFor="cashout-amount">Credits</label>
              <div className="relative [&_span]:pointer-events-none [&_span]:absolute [&_span]:left-3 [&_span]:top-1/2 [&_span]:-translate-y-1/2 [&_span]:text-sm [&_span]:font-semibold [&_span]:text-muted-foreground [&_input]:pl-7">
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
              <p className="text-xs font-medium text-muted-foreground">
                Cashouts send Base USDC to your linked Privy wallet.
              </p>
            </div>
            <div className="grid grid-cols-4 gap-2 max-[560px]:grid-cols-2 [&_button]:px-2">
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

function PrivyWalletSetup({
  disabled,
  onReady,
  onError
}: {
  disabled: boolean;
  onReady: (profile: { depositAddress: string; withdrawalAddress: string | null }) => void;
  onError: (message: string) => void;
}) {
  const { ready, authenticated, login, user } = usePrivy();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const [isLinking, setIsLinking] = useState(false);

  async function setupWallet() {
    onError("");
    setIsLinking(true);
    try {
      if (!authenticated) {
        login();
        return;
      }

      const wallet = wallets[0] ?? (await createWallet());
      const profile = await api.setupPaymentWallet({
        privyUserId: user?.id,
        withdrawalAddress: wallet.address
      });
      onReady({ depositAddress: profile.depositAddress, withdrawalAddress: profile.withdrawalAddress });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Unable to set up USDC wallet.");
    } finally {
      setIsLinking(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4 text-sm text-card-foreground">
      <p>{authenticated && wallets[0] ? `Withdrawal wallet: ${wallets[0].address}` : "Link a Privy wallet for USDC deposits and automatic cashouts."}</p>
      <Button type="button" variant="outline" onClick={setupWallet} disabled={disabled || !ready || isLinking}>
        <Wallet size={18} />
        {isLinking ? "Setting up..." : authenticated ? "Set up USDC wallet" : "Connect wallet"}
      </Button>
    </div>
  );
}
