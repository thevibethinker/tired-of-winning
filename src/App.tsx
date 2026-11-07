import { BrowserRouter, Route, Routes } from "react-router-dom";
import DataDemo from "./pages/data-demo";
import DesignKitDemo from "./pages/_design";
import { ThemeProvider } from "@/components/theme-provider";

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/_design" element={<DesignKitDemo />} />
          <Route path="/" element={<DataDemo />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
