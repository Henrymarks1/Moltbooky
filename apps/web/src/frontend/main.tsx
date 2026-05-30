import { RouterProvider, createRouter } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { Route as rootRoute } from "./routes/root";
import { Route as indexRoute } from "./routes/index";
import { Route as newMarketRoute } from "./routes/new";
import { Route as newChallengeRoute } from "./routes/challenge.new";
import { Route as challengeDetailRoute } from "./routes/challenge.$id";
import { Route as myBetsRoute } from "./routes/my-bets";
import { Route as creditsRoute } from "./routes/credits";
import { Route as apiKeysRoute } from "./routes/settings.api-keys";
import { Route as adminRoute } from "./routes/admin";
import { Route as loginRoute } from "./routes/login";
import { Route as howItWorksRoute } from "./routes/how-it-works";
import { initAnalytics } from "./lib/analytics";
import "./styles.css";

const routeTree = rootRoute.addChildren([
  indexRoute,
  newMarketRoute,
  newChallengeRoute,
  challengeDetailRoute,
  myBetsRoute,
  creditsRoute,
  apiKeysRoute,
  adminRoute,
  loginRoute,
  howItWorksRoute
]);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

initAnalytics();

const app = <RouterProvider router={router} />;

createRoot(document.getElementById("root")!).render(app);
