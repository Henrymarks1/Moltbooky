import { createRoute } from "@tanstack/react-router";
import { ChallengeDraftEditor } from "./challenge.new";
import { rootRoute } from "./root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "new",
  component: NewMarket
});

function NewMarket() {
  return <ChallengeDraftEditor />;
}
