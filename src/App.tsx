import { BrowserRouter, Route, Routes } from "react-router-dom";
import { lazy, Suspense } from "react";
import ElectionNight from "./pages/election-night";
const DesignKitDemo = lazy(() => import("./pages/_design"));
import { ThemeProvider } from "@/components/theme-provider";

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/_design" element={<Suspense fallback={<p>Loading design kit…</p>}><DesignKitDemo /></Suspense>} />
          <Route path="/" element={<ElectionNight />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
