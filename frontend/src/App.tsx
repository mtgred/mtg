import { Link, Outlet } from "react-router-dom"
import CardSearch from "./components/CardSearch"
import CardsMenu from "./components/CardsMenu"

const App = () => {
  return (
    <div className="app">
      <nav className="topbar">
        <Link to="/" className="brand">
          <img className="w-6 h-6" src="/fireball.svg" /> Manaring
        </Link>
        <CardSearch />
        <CardsMenu />
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  )
}

export default App
