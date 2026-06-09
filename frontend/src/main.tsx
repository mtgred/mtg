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
    ],
  },
])

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)
