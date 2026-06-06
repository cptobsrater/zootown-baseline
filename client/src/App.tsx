import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import AdminPage from "@/pages/admin";
import CalendarPage from "@/pages/calendar";
import JobsPage from "@/pages/jobs";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/calendar" component={CalendarPage} />
      <Route path="/jobs" component={JobsPage} />
      <Route path="/admin" component={AdminPage} />
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
          <Router hook={useHashLocation}>
            <AppRouter />
          </Router>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
