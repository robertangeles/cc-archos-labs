export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center bg-canvas px-6 py-20 md:py-28">
      <div className="w-full max-w-[400px]">{children}</div>
    </main>
  );
}
