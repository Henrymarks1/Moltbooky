import { RouterProvider, createRouter } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { Route as rootRoute } from "./routes/root";
import { Route as indexRoute } from "./routes/index";
import { Route as newChallengeRoute } from "./routes/challenge.new";
import { Route as challengeDetailRoute } from "./routes/challenge.$id";
import { Route as walletRoute } from "./routes/wallet";
import { Route as apiKeysRoute } from "./routes/settings.api-keys";
import { Route as adminRoute } from "./routes/admin";
import "./styles.css";

const routeTree = rootRoute.addChildren([
  indexRoute,
  newChallengeRoute,
  challengeDetailRoute,
  walletRoute,
  apiKeysRoute,
  adminRoute
]);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
