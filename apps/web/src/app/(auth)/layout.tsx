export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span aria-hidden className="grid size-10 place-items-center rounded-ctl bg-solder text-lg font-bold text-white">S</span>
          <div>
            <div className="text-lg font-bold leading-tight">Shop ERP</div>
            <div className="text-sm text-ink-3">Sales, stock and repairs for phone and computer shops</div>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
