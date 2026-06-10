import { Switch, Route, Router, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { CityProvider } from "@/lib/city-context";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import AdminPage from "@/pages/admin";
import CalendarPage from "@/pages/calendar";
import JobsPage from "@/pages/jobs";

function AppRouter() {
  return (
    <Switch>
      {/* Root redirects to Missoula */}
      <Route path="/">
        <Redirect to="/missoula" />
      </Route>

      {/* Admin is not city-scoped at the URL level (admin uses an in-page city switcher) */}
      <Route path="/admin" component={AdminPage} />

      {/* City-scoped routes */}
      <Route path="/:city/calendar" component={CalendarPage} />
      <Route path="/:city/jobs" component={JobsPage} />
      <Route path="/:city" component={Home} />

      {/* Legacy fall-throughs */}
      <Route path="/calendar">
        <Redirect to="/missoula/calendar" />
      </Route>
      <Route path="/jobs">
        <Redirect to="/missoula/jobs" />
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Router>
            <CityProvider>
              <AppRouter />
            </CityProvider>
          </Router>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
