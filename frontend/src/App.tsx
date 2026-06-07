import { Link, Outlet } from "react-router-dom"
import CardSearch from "./components/CardSearch"

const App = () => {
  return (
    <div className="app">
      <nav className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">✦</span> Manaring
        </Link>
        <CardSearch />
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  )
}

export default App
