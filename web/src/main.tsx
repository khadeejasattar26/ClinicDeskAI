import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { ClinicPage } from "./ClinicPage";
import "./global.css";
const AdminRoutes = lazy(() => import("./AdminRoutes"));
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <a href="#main-content" className="skip">
        Skip to content
      </a>
      <Routes>
        <Route path="/" element={<ClinicPage />} />
        <Route
          path="/admin/*"
          element={
            <Suspense
              fallback={
                <main id="main-content" style={{ padding: 50 }} role="status">
                  Opening your clinic workspace…
                </main>
              }
            >
              <AdminRoutes />
            </Suspense>
          }
        />
        <Route
          path="*"
          element={
            <main id="main-content" style={{ padding: 50 }}>
              <h1>Page not found</h1>
              <Link to="/">Return to CareWell</Link>
            </main>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
