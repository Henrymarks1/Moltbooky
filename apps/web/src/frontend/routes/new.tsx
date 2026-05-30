import { createRoute } from "@tanstack/react-router";
import { NewChallenge } from "./challenge.new";
import { rootRoute } from "./root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "new",
  component: NewMarket
});

function NewMarket() {
  return <NewChallenge />;
}
