import { Link, Outlet } from "react-router-dom"

const App = () => {
  return (
    <div className="app">
      <nav className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">✦</span> Manaring
        </Link>
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  )
}

export default App
