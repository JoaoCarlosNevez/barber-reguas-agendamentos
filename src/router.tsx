import { createBrowserRouter } from 'react-router'
import { Layout } from '@/components/Layout'
import { RequireRole } from '@/components/RequireRole'
import { AccountPage } from '@/pages/account/AccountPage'
import { AdminPage } from '@/pages/admin/AdminPage'
import { LoginPage } from '@/pages/auth/LoginPage'
import { SignupPage } from '@/pages/auth/SignupPage'
import { BarberPage } from '@/pages/barber/BarberPage'
import { AppointmentPage } from '@/pages/booking/AppointmentPage'
import { BookingPage } from '@/pages/booking/BookingPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { RouteErrorPage } from '@/pages/RouteErrorPage'

export const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <BookingPage /> },
      { path: 'agendamento/:token', element: <AppointmentPage /> },
      { path: 'entrar', element: <LoginPage /> },
      { path: 'cadastro', element: <SignupPage /> },
      {
        path: 'minha-conta',
        element: (
          <RequireRole>
            <AccountPage />
          </RequireRole>
        ),
      },
      {
        path: 'barbeiro',
        element: (
          <RequireRole roles={['barber', 'admin']}>
            <BarberPage />
          </RequireRole>
        ),
      },
      {
        path: 'admin',
        element: (
          <RequireRole roles={['admin']}>
            <AdminPage />
          </RequireRole>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
