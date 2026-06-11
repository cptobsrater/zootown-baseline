import { Switch, Route, Router, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { CityProvider } from "@/lib/city-context";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import Home from "@/pages/home";
import AdminPage from "@/pages/admin";
import CalendarPage from "@/pages/calendar";
import JobsPage from "@/pages/jobs";

function AppRouter() {
  return (
    <Switch>
      {/* Root shows the city picker landing page */}
      <Route path="/" component={Landing} />

      {/* Admin is not city-scoped at the URL level (admin uses an in-page city switcher) */}
      <Route path="/admin" component={AdminPage} />

      {/* Legacy old-slug fall-through (great_falls -> greatfalls) */}
      <Route path="/great_falls">
        <Redirect to="/greatfalls" />
      </Route>
      <Route path="/great_falls/:rest*">
        {(params) => <Redirect to={`/greatfalls/${params.rest ?? ""}`} />}
      </Route>

      {/* City-scoped routes */}
      <Route path="/:city/calendar" component={CalendarPage} />
      <Route path="/:city/jobs" component={JobsPage} />
      {/* Story deep link — same Home component, but the storyId param tells
          it to auto-open the drawer to that story so shared links land
          straight on the article. */}
      <Route path="/:city/story/:storyId" component={Home} />
      <Route path="/:city" component={Home} />

      {/* Legacy fall-throughs for the old root-level pages */}
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
