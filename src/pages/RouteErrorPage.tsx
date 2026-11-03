import { isRouteErrorResponse, Link, useRouteError } from 'react-router'

export function RouteErrorPage() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} — ${error.statusText}`
    : 'Algo deu errado. Tente novamente.'

  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-3xl font-bold">Ops!</h1>
      <p className="mt-2 text-muted">{message}</p>
      <Link to="/" className="mt-6 inline-block text-brass underline underline-offset-4">
        Ir para o início
      </Link>
    </div>
  )
}
