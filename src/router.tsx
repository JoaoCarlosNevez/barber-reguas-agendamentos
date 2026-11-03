import { createBrowserRouter, Navigate } from 'react-router'
import { Layout } from '@/components/Layout'
import { RequireRole } from '@/components/RequireRole'
import { MANAGER_ROLES, STAFF_ROLES } from '@/lib/auth'
import { AccountPage } from '@/pages/account/AccountPage'
import { AdminLayout, AdminPage } from '@/pages/admin/AdminPage'
import { AppAccountPage } from '@/pages/app/AppAccountPage'
import { AppAgendaPage } from '@/pages/app/AppAgendaPage'
import { AppLayout } from '@/pages/app/AppLayout'
import { AppManagePage } from '@/pages/app/AppManagePage'
import { LoginPage } from '@/pages/auth/LoginPage'
import { CustomerLoginPage } from '@/pages/auth/CustomerLoginPage'
import { AppointmentPage } from '@/pages/booking/AppointmentPage'
import { BookingPage } from '@/pages/booking/BookingPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { RouteErrorPage } from '@/pages/RouteErrorPage'

export const router = createBrowserRouter([
  // Site público (web mobile): agendamento e área do cliente
  {
    element: <Layout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <BookingPage /> },
      { path: 'agendamento/:token', element: <AppointmentPage /> },
      { path: 'entrar', element: <CustomerLoginPage /> },
      { path: 'entrar/equipe', element: <LoginPage /> },
      { path: 'cadastro', element: <Navigate to="/entrar" replace /> },
      {
        path: 'minha-conta',
        element: (
          <RequireRole>
            <AccountPage />
          </RequireRole>
        ),
      },
      { path: 'barbeiro', element: <Navigate to="/app" replace /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  // App da equipe (PWA): dono e barbeiros
  {
    path: 'app',
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: 'entrar', element: <LoginPage variant="app" /> },
      {
        index: true,
        element: (
          <RequireRole roles={STAFF_ROLES} loginPath="/app/entrar">
            <AppAgendaPage />
          </RequireRole>
        ),
      },
      {
        path: 'gestao',
        element: (
          <RequireRole roles={MANAGER_ROLES} loginPath="/app/entrar">
            <AppManagePage />
          </RequireRole>
        ),
      },
      {
        path: 'conta',
        element: (
          <RequireRole roles={STAFF_ROLES} loginPath="/app/entrar">
            <AppAccountPage />
          </RequireRole>
        ),
      },
      { path: '*', element: <Navigate to="/app" replace /> },
    ],
  },
  // Painel do super admin (web)
  {
    path: 'admin',
    element: <AdminLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        index: true,
        element: (
          <RequireRole roles={['super_admin']} loginPath="/entrar/equipe">
            <AdminPage />
          </RequireRole>
        ),
      },
      { path: '*', element: <Navigate to="/admin" replace /> },
    ],
  },
])
