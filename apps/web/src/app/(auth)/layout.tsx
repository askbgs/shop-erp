import { AuthCarousel } from '@/components/auth-carousel';
import { Logo } from '@/components/shell';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-surface lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Form side */}
      <div className="flex min-h-dvh flex-col px-6 py-6 sm:px-10 lg:px-14">
        <header className="flex items-center gap-3">
          <Logo />
          <span className="text-lg font-bold">Shop ERP</span>
        </header>
        <div className="mt-5 rounded-[20px] bg-night p-4 lg:hidden">
          <AuthCarousel compact />
        </div>
        <main className="flex flex-1 items-start pt-8 pb-10 lg:items-center lg:py-10">
          <div className="mx-auto w-full max-w-[26rem]">{children}</div>
        </main>
        <footer className="text-sm text-ink-3">Sales, stock and repairs for phone and computer shops in Sri Lanka</footer>
      </div>

      {/* Carousel side */}
      <aside className="hidden p-4 lg:block">
        <div className="sticky top-4 flex h-[calc(100dvh-2rem)] flex-col rounded-[28px] bg-night px-10 pt-12 pb-10 xl:px-16">
          <AuthCarousel />
        </div>
      </aside>
    </div>
  );
}
