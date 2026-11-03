import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <section className="py-16 text-center">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="mt-2 text-muted">Página não encontrada.</p>
      <Link to="/" className="mt-6 inline-block text-brass underline underline-offset-4">
        Voltar para o agendamento
      </Link>
    </section>
  )
}
