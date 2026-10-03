import { createBrowserRouter, Link, Navigate, RouterProvider } from 'react-router'
import { HomePage } from '../pages/HomePage'
import { RoomPage } from '../pages/RoomPage'
import { AccountPage, AuthPage } from '../pages/AccountPage'
import { WorkspacePage } from '../pages/WorkspacePage'
import { InvitePage } from '../pages/InvitePage'
import { UpdateBanner } from '../features/desktop/UpdateBanner'

function NotFound() {
  return (
    <main className="center-page">
      <section className="card">
        <h1>Página não encontrada</h1>
        <Link className="btn btn-primary" to="/">
          Início
        </Link>
      </section>
    </main>
  )
}

export const routes = [
  { path: '/', element: <Navigate to="/app" replace /> },
  { path: '/legacy', element: <HomePage /> },
  { path: '/app', element: <WorkspacePage /> },
  { path: '/app/:serverId', element: <WorkspacePage /> },
  { path: '/invite/:code', element: <InvitePage /> },
  { path: '/login', element: <AuthPage /> },
  { path: '/register', element: <AuthPage key="register" register /> },
  { path: '/account', element: <AccountPage /> },
  { path: '/room/:code', element: <RoomPage /> },
  // formato curto alternativo: /s/ABC123
  { path: '/s/:code', element: <RoomPage /> },
  { path: '*', element: <NotFound /> },
]

const router = createBrowserRouter(routes)

export function App() {
  return <><UpdateBanner /><RouterProvider router={router} /></>
}
