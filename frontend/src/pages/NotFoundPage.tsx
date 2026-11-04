import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <div className="space-y-2">
      <h1 className="font-serif text-3xl">Page not found</h1>
      <Link to="/" className="text-brand underline">
        Back home
      </Link>
    </div>
  )
}
