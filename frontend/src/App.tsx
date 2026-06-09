import { Link, Outlet } from "react-router-dom"
import CardSearch from "./components/CardSearch"

const App = () => {
  return (
    <div className="app">
      <nav className="topbar">
        <Link to="/" className="brand">
          <img className="w-6 h-6" src="/fireball.svg" /> Manaring
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
