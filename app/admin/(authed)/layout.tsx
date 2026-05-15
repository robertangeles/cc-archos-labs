import { AdminTabNav } from "./admin-tab-nav";
import { SignOutButton } from "./sign-out-button";

// Authenticated admin shell. Anything under app/admin/(authed)/* gets:
//   - "Admin" eyebrow + Sign-out button (top bar)
//   - Settings tabs sidebar on the left (SEO & Brand active by default;
//     future tabs slot in via admin-tab-nav.tsx)
//   - Content area on the right (the actual settings page renders here)
//
// /admin/login lives outside this route group so the password screen
// renders without admin chrome.

export default function AuthedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 flex-col bg-canvas">
      <div className="mx-auto w-full max-w-[1080px] px-6 pt-16 pb-32 md:px-12">
        <div className="mb-12 flex items-center justify-between gap-x-4">
          <p className="uppercase text-eyebrow text-ink-subtle">
            Admin
          </p>
          <SignOutButton />
        </div>

        <div className="grid gap-x-12 gap-y-8 md:grid-cols-[200px_1fr]">
          <aside>
            <AdminTabNav />
          </aside>
          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </main>
  );
}
