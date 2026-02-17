import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import Dashboard from "@/pages/Dashboard";
import Upload from "@/pages/Upload";
import Review from "@/pages/Review";
import EntryView from "@/pages/EntryView";
import Receivables from "@/pages/Receivables";
import DepositBatches from "@/pages/DepositBatches";
import BrowseFiles from "@/pages/BrowseFiles";
import SearchPage from "@/pages/SearchPage";
import Exceptions from "@/pages/Exceptions";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppLayout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/review" element={<Review />} />
            <Route path="/entry" element={<EntryView />} />
            <Route path="/receivables" element={<Receivables />} />
            <Route path="/batches" element={<DepositBatches />} />
            <Route path="/browse" element={<BrowseFiles />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/exceptions" element={<Exceptions />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AppLayout>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
