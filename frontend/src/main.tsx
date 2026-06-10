import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom"
import "./index.css"
import App from "./App.tsx"
import SetsPage from "./routes/SetsPage.tsx"
import SetPage from "./routes/SetPage.tsx"
import CardPage from "./routes/CardPage.tsx"
import ArtistsPage from "./routes/ArtistsPage.tsx"
import ArtistPage from "./routes/ArtistPage.tsx"
import SignInPage from "./routes/SignInPage.tsx"
import SignUpPage from "./routes/SignUpPage.tsx"
import { AuthProvider } from "./lib/AuthProvider.tsx"

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/sets" replace /> },
      { path: "sets", element: <SetsPage /> },
      { path: "sets/:code", element: <SetPage /> },
      { path: "cards/:id", element: <CardPage /> },
      { path: "artists", element: <ArtistsPage /> },
      { path: "artists/:name", element: <ArtistPage /> },
      { path: "signin", element: <SignInPage /> },
      { path: "signup", element: <SignUpPage /> },
    ],
  },
])

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>
)
