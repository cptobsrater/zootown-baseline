import { Switch, Route, Router, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { CityProvider } from "@/lib/city-context";
import { AdminCityProvider } from "@/lib/admin-city-context";
import { EditModeProvider } from "@/lib/edit-mode";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import Home from "@/pages/home";
import AdminPage from "@/pages/admin";
import CockpitPage from "@/pages/cockpit";
import CockpitLivePage from "@/pages/cockpit-live";
import RulesQueuePage from "@/pages/rules-queue";
import XUnmappedPage from "@/pages/x-unmapped";
import SynthesisQueuePage from "@/pages/synthesis-queue";
import CalendarPage from "@/pages/calendar";
import JobsPage from "@/pages/jobs";
import FeedbackPage from "@/pages/feedback";
import { FeedbackButton } from "@/components/FeedbackButton";
import { EditModeToggle } from "@/components/EditModeToggle";

function AppRouter() {
  return (
    <Switch>
      {/* Root shows the city picker landing page */}
      <Route path="/" component={Landing} />

      {/* Phase 6 editorial cockpit — saved feed presets, live preview, etc.
          Must come BEFORE the bare /admin route so wouter matches it first. */}
      <Route path="/admin/cockpit" component={CockpitPage} />
      <Route path="/admin/cockpit-live" component={CockpitLivePage} />
      <Route path="/admin/rules-queue" component={RulesQueuePage} />
      <Route path="/admin/x-unmapped" component={XUnmappedPage} />
      <Route path="/admin/synthesis-queue" component={SynthesisQueuePage} />
      {/* Admin is not city-scoped at the URL level (admin uses an in-page city switcher) */}
      <Route path="/admin" component={AdminPage} />

      {/* Public feedback page -- linked from the floating Feedback button. */}
      <Route path="/feedback" component={FeedbackPage} />

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
              {/* AdminCityProvider at the root so editorial mode on public
                  pages can mount the admin StoryEditDialog (which depends on
                  useAdminCity for the city dropdown). The /admin and
                  /admin/cockpit pages mount their own inner AdminCityProvider;
                  the inner one shadows this outer one, which is the desired
                  separation: cockpit tracks its own admin-city state, while
                  public-page editorial mode uses this root one. */}
              <AdminCityProvider>
                <EditModeProvider>
                  <AppRouter />
                  {/* Global floating Feedback button -- hides itself on
                      /feedback and admin routes; see component for details. */}
                  <FeedbackButton />
                  {/* Floating pill that toggles editorial mode. Only renders
                      when an admin token is present in this tab. */}
                  <EditModeToggle />
                </EditModeProvider>
              </AdminCityProvider>
            </CityProvider>
          </Router>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
