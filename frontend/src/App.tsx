import { Link, NavLink, Outlet } from "react-router-dom"
import CardSearch from "./components/CardSearch"
import CardsMenu from "./components/CardsMenu"
import MetaMenu from "./components/MetaMenu"
import AccountMenu from "./components/AccountMenu"
import { useAuth } from "./lib/auth"

const App = () => {
  const { user } = useAuth()
  return (
    <div className="app">
      <nav className="topbar">
        <Link to="/" className="brand">
          <img className="w-6 h-6" src="/fireball.svg" /> Manaring
        </Link>
        <CardSearch />
        <MetaMenu />
        <CardsMenu />
        {user && (
          <NavLink to="/decks" className={({ isActive }) => `navlink${isActive ? " is-active" : ""}`}>
            Decks
          </NavLink>)}
        <AccountMenu />
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  )
}

export default App
