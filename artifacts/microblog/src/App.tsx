import { Switch, Route, Router as WouterRouter, useRoute, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { ThemeInjector } from "@/components/layout/ThemeInjector";
import Home from "@/pages/home";
import SettingsPage from "@/pages/settings";
import PostDetail from "@/pages/post-detail";
import PostEmbed from "@/pages/post-embed";
import PieceEmbed from "@/pages/piece-embed";
import UserProfile from "@/pages/user-profile";
import SignInPage from "@/pages/sign-in";
import SignUpPage from "@/pages/sign-up";
import AdminFeedsPage from "@/pages/admin-feeds";
import AdminPendingPage from "@/pages/admin-pending";
import AdminIndexPage from "@/pages/admin/admin-index";
import AdminCategoriesPage from "@/pages/admin/admin-categories";
import AdminNavigationPage from "@/pages/admin/admin-navigation";
import AdminPagesPage from "@/pages/admin/admin-pages";
import AdminPageEditor from "@/pages/admin/admin-page-editor";
import AdminAiPage from "@/pages/admin/admin-ai";
import AdminPiecesPage from "@/pages/admin/admin-pieces";
import AdminLibraryPage from "@/pages/admin/admin-library";
import AdminPlatformsPage from "@/pages/admin/admin-platforms";
import AdminPostsPage from "@/pages/admin-posts";
import SearchPage from "@/pages/search";
import CategoryDetailPage from "@/pages/category-detail";
import FeedsIndexPage from "@/pages/feeds";
import CategoriesIndexPage from "@/pages/categories";
import PageDetailPage from "@/pages/page-detail";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function AdminRedirect() {
  return <Redirect to="/admin/site" />;
}

function AppShell() {
  const [isPostEmbed] = useRoute("/embed/posts/:id");
  const [isPieceEmbed] = useRoute("/embed/pieces/:id");

  if (isPostEmbed || isPieceEmbed) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeInjector />
        <Switch>
          <Route path="/embed/posts/:id" component={PostEmbed} />
          <Route path="/embed/pieces/:id" component={PieceEmbed} />
        </Switch>
        <Toaster />
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeInjector />
      <div className="flex min-h-[100dvh] flex-col bg-background">
        <Navbar />
        <main className="flex-1">
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/settings" component={SettingsPage} />
            <Route path="/admin" component={AdminRedirect} />
            <Route path="/admin/site" component={AdminIndexPage} />
            <Route path="/admin/posts" component={AdminPostsPage} />
            <Route path="/admin/ai" component={AdminAiPage} />
            <Route path="/admin/pieces" component={AdminPiecesPage} />
            <Route path="/admin/library" component={AdminLibraryPage} />
            <Route path="/admin/platforms" component={AdminPlatformsPage} />
            <Route path="/admin/categories" component={AdminCategoriesPage} />
            <Route path="/admin/navigation" component={AdminNavigationPage} />
            <Route path="/admin/pages" component={AdminPagesPage} />
            <Route path="/admin/pages/new" component={AdminPageEditor} />
            <Route path="/admin/pages/:id" component={AdminPageEditor} />
            <Route path="/admin/pages/:id/edit" component={AdminPageEditor} />
            <Route path="/admin/feeds" component={AdminFeedsPage} />
            <Route path="/admin/pending" component={AdminPendingPage} />
            <Route path="/search" component={SearchPage} />
            <Route path="/feeds" component={FeedsIndexPage} />
            <Route path="/categories" component={CategoriesIndexPage} />
            <Route path="/categories/:slug" component={CategoryDetailPage} />
            <Route path="/p/:slug" component={PageDetailPage} />
            <Route path="/posts/:id" component={PostDetail} />
            <Route path="/users/:userId" component={UserProfile} />
            <Route path="/sign-in" component={SignInPage} />
            <Route path="/sign-up" component={SignUpPage} />
            <Route component={NotFound} />
          </Switch>
        </main>
        <Footer />
      </div>

      <Toaster />
    </QueryClientProvider>
  );
}

function App() {
  return (
    <TooltipProvider>
      <WouterRouter base={basePath}>
        <AppShell />
      </WouterRouter>
    </TooltipProvider>
  );
}

export default App;
