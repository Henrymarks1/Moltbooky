import { createRoute } from "@tanstack/react-router";
import { NewChallenge } from "./challenge.new";
import { rootRoute } from "./root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "new",
  validateSearch: (search: Record<string, unknown>): { claim?: string } => ({
    claim: typeof search.claim === "string" ? search.claim : undefined
  }),
  component: NewMarket
});

function NewMarket() {
  const { claim } = Route.useSearch();
  return <NewChallenge initialClaim={claim ?? ""} />;
}
