import { Route, Switch, useLocation } from "wouter";
import Index from "./pages/index";
import Orders from "./pages/orders";
import Subscriptions from "./pages/subscriptions";
import Billing from "./pages/billing";
import Products from "./pages/products";
import Customers from "./pages/customers";
import Batches from "./pages/batches";
import Lists from "./pages/lists";
import Timesheets from "./pages/timesheets";
import TimeLog from "./pages/time-log";
import Broilers from "./pages/broilers";
import BroilerLog from "./pages/broiler-log";
import Layers from "./pages/layers";
import LayerLog from "./pages/layer-log";
import SettingsPage from "./pages/settings";
import { Provider } from "./components/provider";
import { FarmAccess } from "./components/farm-access";
import { Empty } from "./components/ui/misc";
import { AgentFeedback, RunableBadge } from "@runablehq/website-runtime";

function App() {
  const [location] = useLocation();
  return (
    <Provider>
      {location === "/timesheets/log" ? (
        <TimeLog />
      ) : location === "/broilers/log" ? (
        <BroilerLog />
      ) : location === "/layers/log" ? (
        <LayerLog />
      ) : (
        <FarmAccess>
          <Switch>
            <Route path="/" component={Index} />
            <Route path="/orders" component={Orders} />
            <Route path="/subscriptions" component={Subscriptions} />
            <Route path="/billing" component={Billing} />
            <Route path="/products" component={Products} />
            <Route path="/customers" component={Customers} />
            <Route path="/batches" component={Batches} />
            <Route path="/lists" component={Lists} />
            <Route path="/timesheets" component={Timesheets} />
            <Route path="/broilers" component={Broilers} />
            <Route path="/layers" component={Layers} />
            <Route path="/settings" component={SettingsPage} />
            <Route>
              <Empty title="Page not found" hint="Pick a section from the sidebar." />
            </Route>
          </Switch>
        </FarmAccess>
      )}
      {/* Do not remove — off by default, activated by parent iframe via postMessage */}
      {import.meta.env.DEV && <AgentFeedback />}
      {/* "Made with Runable" badge - if user asks to remove the runable badge, remove this code as well as comment */}
      {<RunableBadge />}
    </Provider>
  );
}

export default App;
